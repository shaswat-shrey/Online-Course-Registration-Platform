import { ErrorCode, type externalRecordSchema } from '@ucrams/shared';
import type { z } from 'zod';
import type { ActorContext } from '../../common/context/actor.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import { covers } from '../authz/authz.js';
import { queueNotifications } from '../notifications/notifications.service.js';

/**
 * Transfer credits and exemptions (FR-ACAD-007). They count towards
 * prerequisites and degree progress like any passed course, never towards the
 * GPA, and are append-only like every academic record (FR-ACAD-009).
 */
export async function addExternalRecord(
  actor: ActorContext,
  studentId: string,
  input: z.output<typeof externalRecordSchema>,
) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      userId: true,
      program: { select: { departmentId: true, department: { select: { schoolId: true } } } },
    },
  });
  if (
    !student ||
    !covers(actor.grants, 'record:manage', {
      departmentId: student.program.departmentId,
      schoolId: student.program.department.schoolId,
    })
  )
    throw new NotFoundError('Student');
  const course = await prisma.course.findUnique({
    where: { id: input.courseId },
    select: { id: true, code: true, title: true, credits: true },
  });
  if (!course)
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Unknown course', {
      fields: [{ path: 'body.courseId', message: 'Unknown course' }],
    });
  const passed = await prisma.academicRecord.count({
    where: { studentId, courseId: course.id, passed: true },
  });
  if (passed)
    throw new ConflictError(
      ErrorCode.CONFLICT,
      `${course.code} is already completed on this student's record`,
    );
  const credits = input.credits ?? course.credits.toNumber();
  let after: () => void = () => undefined;
  const record = await prisma.$transaction(async (tx) => {
    const r = await tx.academicRecord.create({
      data: {
        studentId,
        courseId: course.id,
        sessionId: null,
        source: input.source,
        courseCodeSnapshot: course.code,
        courseTitleSnapshot: course.title,
        creditsAttempted: credits,
        creditsEarned: credits,
        gradeLetter: input.source === 'TRANSFER' ? input.gradeLetter : null,
        gradePoints: null,
        countsInGpa: false,
        passed: true,
        externalInstitution: input.source === 'TRANSFER' ? input.externalInstitution : null,
        note: input.note,
        enteredById: actor.userId,
      },
    });
    after = await queueNotifications(tx, [
      {
        userId: student.userId,
        category: 'GRADES',
        title: `${input.source === 'TRANSFER' ? 'Transfer credit' : 'Exemption'} recorded: ${course.code}`,
        body: `${course.code} ${course.title} now counts towards your programme (${credits} credits).`,
        link: '/student/history',
      },
    ]);
    await recordAudit(
      actor,
      {
        action: input.source === 'TRANSFER' ? 'record.transfer_added' : 'record.exemption_added',
        entityType: 'AcademicRecord',
        entityId: r.id,
        changes: {
          studentId,
          course: course.code,
          credits,
          institution: input.externalInstitution,
        },
      },
      tx,
    );
    return r;
  });
  after();
  return { id: record.id, course: course.code, credits, source: record.source };
}
