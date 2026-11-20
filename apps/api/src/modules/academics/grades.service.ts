import { ErrorCode, letterFor, type finalGradesSchema } from '@ucrams/shared';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext } from '../../common/context/actor.js';
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
} from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import { covers, hasPermission, scopeFilter } from '../authz/authz.js';
import {
  queueNotifications,
  type NewNotification,
} from '../notifications/notifications.service.js';
import { endRegistration } from '../registrations/registration-core.js';
import { canInSection, sectionAccess, type SectionAccess } from '../teaching/teaching-access.js';
import { computedPercents, totalWeight } from './assessments.service.js';

const EDITABLE = ['DRAFT', 'RETURNED'] as const;

/** The session's grading scale; grading is impossible without one (FR-ACAD-005). */
async function scaleFor(sessionId: string) {
  const session = await prisma.academicSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: {
      name: true,
      gradingScale: {
        select: { name: true, entries: { orderBy: { position: 'asc' } } },
      },
    },
  });
  const bands = (session.gradingScale?.entries ?? []).map((e) => ({
    letter: e.letter,
    minPercent: e.minPercent.toNumber(),
    gradePoints: e.gradePoints?.toNumber() ?? null,
    isPassing: e.isPassing,
    countsInGpa: e.countsInGpa,
  }));
  return { name: session.gradingScale?.name ?? null, bands };
}

/** Primary instructors holding `grade:submit` enter and submit grades (FR-ACAD-006). */
const canSubmit = (actor: ActorContext, access: SectionAccess) =>
  access.instructor?.role === 'PRIMARY' && hasPermission(actor.grants, 'grade:submit');
const canDecide = (actor: ActorContext, access: SectionAccess) =>
  covers(actor.grants, 'grade:approve', access.target);

async function load(actor: ActorContext, sectionId: string) {
  const access = await sectionAccess(actor, sectionId);
  const submit = canSubmit(actor, access);
  const decide = canDecide(actor, access);
  if (!submit && !decide && !canInSection(actor, access, 'roster:read'))
    throw new NotFoundError('Section');
  return { access, submit, decide };
}

/**
 * The grade sheet: every graded student with the computed mark, the suggested
 * letter from the session scale and the entered letter, plus workflow state.
 */
export async function gradeSheet(actor: ActorContext, sectionId: string) {
  const { access, submit, decide } = await load(actor, sectionId);
  const [scale, submission, regs, percents, weight] = await Promise.all([
    scaleFor(access.section.sessionId),
    prisma.finalGradeSubmission.findUnique({
      where: { sectionId },
      include: {
        entries: true,
        submittedBy: { select: { firstName: true, lastName: true } },
        decidedBy: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.courseRegistration.findMany({
      where: { sectionId, status: { in: ['REGISTERED', 'COMPLETED'] } },
      include: {
        student: {
          select: {
            id: true,
            studentNumber: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
        record: { select: { gradeLetter: true, version: true } },
      },
      orderBy: [{ student: { user: { lastName: 'asc' } } }],
    }),
    computedPercents(sectionId),
    totalWeight(sectionId),
  ]);
  const status = submission?.status ?? 'DRAFT';
  const entries = new Map(submission?.entries.map((e) => [e.registrationId, e]) ?? []);
  const name = (u: { firstName: string; lastName: string } | null) =>
    u ? `${u.firstName} ${u.lastName}` : null;
  return {
    section: {
      id: sectionId,
      label: `${access.section.course.code} ${access.section.sectionCode}`,
      title: access.section.course.title,
    },
    scale: scale.name ? { name: scale.name, bands: scale.bands } : null,
    status,
    submittedBy: name(submission?.submittedBy ?? null),
    submittedAt: submission?.submittedAt?.toISOString() ?? null,
    decidedBy: name(submission?.decidedBy ?? null),
    decidedAt: submission?.decidedAt?.toISOString() ?? null,
    returnReason: submission?.returnReason ?? null,
    postedAt: submission?.postedAt?.toISOString() ?? null,
    assessmentWeight: weight,
    canEdit: submit && (EDITABLE as readonly string[]).includes(status),
    canDecide: decide && status === 'SUBMITTED',
    students: regs.map((r) => {
      const percent = percents.out.get(r.student.id) ?? (percents.hasComponents ? 0 : null);
      const record = r.record;
      return {
        registrationId: r.id,
        studentId: r.student.id,
        studentNumber: r.student.studentNumber,
        name: `${r.student.user.firstName} ${r.student.user.lastName}`,
        registrationStatus: r.status,
        percent,
        suggested: percent === null ? null : (letterFor(scale.bands, percent)?.letter ?? null),
        gradeLetter: record?.gradeLetter ?? entries.get(r.id)?.gradeLetter ?? null,
        posted: !!record,
      };
    }),
  };
}

function assertLetters(letters: string[], bands: Array<{ letter: string }>) {
  const valid = new Set(bands.map((b) => b.letter));
  const bad = [...new Set(letters.filter((l) => !valid.has(l)))];
  if (bad.length)
    throw new BusinessRuleError(
      ErrorCode.VALIDATION_ERROR,
      `Not on the grading scale: ${bad.join(', ')}`,
      {
        fields: [{ path: 'body.grades', message: `Use one of ${[...valid].join(', ')}` }],
      },
    );
}

/** Saves draft grades; allowed while the sheet is a draft or was returned. */
export async function saveGrades(
  actor: ActorContext,
  sectionId: string,
  input: z.output<typeof finalGradesSchema>,
) {
  const { access, submit } = await load(actor, sectionId);
  if (!submit) throw new ForbiddenError('Only the primary instructor enters final grades');
  const scale = await scaleFor(access.section.sessionId);
  if (!scale.bands.length)
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'This session has no grading scale');
  assertLetters(
    input.grades.map((g) => g.gradeLetter),
    scale.bands,
  );
  const graded = await prisma.courseRegistration.findMany({
    where: {
      sectionId,
      status: 'REGISTERED',
      id: { in: input.grades.map((g) => g.registrationId) },
    },
    select: { id: true },
  });
  if (graded.length !== input.grades.length)
    throw new BusinessRuleError(
      ErrorCode.VALIDATION_ERROR,
      'Some students are not registered here',
      {
        fields: [{ path: 'body.grades', message: 'Only registered students are graded' }],
      },
    );
  const existing = await prisma.finalGradeSubmission.findUnique({ where: { sectionId } });
  if (existing && !(EDITABLE as readonly string[]).includes(existing.status))
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      existing.status === 'POSTED' ? 'Grades have been posted' : 'Grades are awaiting approval',
    );
  const percents = await computedPercents(sectionId);
  const studentOf = new Map(
    (
      await prisma.courseRegistration.findMany({
        where: { id: { in: input.grades.map((g) => g.registrationId) } },
        select: { id: true, studentId: true },
      })
    ).map((r) => [r.id, r.studentId]),
  );
  await prisma.$transaction(async (tx) => {
    const sub = await tx.finalGradeSubmission.upsert({
      where: { sectionId },
      create: { sectionId },
      update: {},
    });
    for (const g of input.grades) {
      const percent = percents.out.get(studentOf.get(g.registrationId)!) ?? null;
      await tx.finalGradeEntry.upsert({
        where: { registrationId: g.registrationId },
        create: {
          registrationId: g.registrationId,
          submissionId: sub.id,
          gradeLetter: g.gradeLetter,
          percent,
        },
        update: { gradeLetter: g.gradeLetter, percent },
      });
    }
  });
  return gradeSheet(actor, sectionId);
}

/** Submits for approval once every registered student has a grade and weights total 100 %. */
export async function submitGrades(actor: ActorContext, sectionId: string) {
  const { submit } = await load(actor, sectionId);
  if (!submit) throw new ForbiddenError('Only the primary instructor submits final grades');
  const sub = await prisma.finalGradeSubmission.findUnique({
    where: { sectionId },
    include: { entries: { select: { registrationId: true } } },
  });
  if (sub && !(EDITABLE as readonly string[]).includes(sub.status))
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      'Grades were already submitted',
    );
  const registered = await prisma.courseRegistration.findMany({
    where: { sectionId, status: 'REGISTERED' },
    select: { id: true },
  });
  if (!registered.length)
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'No registered students to grade');
  const entered = new Set(sub?.entries.map((e) => e.registrationId) ?? []);
  const missing = registered.filter((r) => !entered.has(r.id)).length;
  if (missing)
    throw new BusinessRuleError(
      ErrorCode.VALIDATION_ERROR,
      `${missing} student(s) have no grade yet`,
    );
  const weight = await totalWeight(sectionId);
  if (weight > 0 && Math.abs(weight - 100) > 0.001)
    throw new BusinessRuleError(
      ErrorCode.VALIDATION_ERROR,
      `Assessment weights total ${weight} %; they must total 100 % (FR-ACAD-004)`,
    );
  await prisma.finalGradeSubmission.update({
    where: { sectionId },
    data: {
      status: 'SUBMITTED',
      submittedById: actor.userId,
      submittedAt: new Date(),
      returnReason: null,
    },
  });
  await recordAudit(actor, {
    action: 'grades.submitted',
    entityType: 'CourseSection',
    entityId: sectionId,
    changes: { students: registered.length },
  });
  return gradeSheet(actor, sectionId);
}

/** Sends the sheet back to the instructor with a reason. */
export async function returnGrades(actor: ActorContext, sectionId: string, reason: string) {
  const { access, decide } = await load(actor, sectionId);
  if (!decide) throw new ForbiddenError();
  const sub = await prisma.finalGradeSubmission.findUnique({ where: { sectionId } });
  if (sub?.status !== 'SUBMITTED')
    throw new BusinessRuleError(ErrorCode.INVALID_STATE_TRANSITION, 'Nothing is awaiting approval');
  let after: () => void = () => undefined;
  await prisma.$transaction(async (tx) => {
    await tx.finalGradeSubmission.update({
      where: { sectionId },
      data: {
        status: 'RETURNED',
        decidedById: actor.userId,
        decidedAt: new Date(),
        returnReason: reason,
      },
    });
    if (sub.submittedById)
      after = await queueNotifications(tx, [
        {
          userId: sub.submittedById,
          category: 'GRADES',
          title: `Grades returned: ${access.section.course.code} ${access.section.sectionCode}`,
          body: reason,
          link: `/faculty/sections/${sectionId}?tab=grades`,
        },
      ]);
    await recordAudit(
      actor,
      {
        action: 'grades.returned',
        entityType: 'CourseSection',
        entityId: sectionId,
        changes: { reason },
      },
      tx,
    );
  });
  after();
  return gradeSheet(actor, sectionId);
}

/**
 * Approves and posts (FR-ACAD-006/007): one academic record per graded
 * registration with points and credits from the session scale; the
 * registration becomes COMPLETED; students are notified.
 */
export async function approveGrades(actor: ActorContext, sectionId: string) {
  const { access, decide } = await load(actor, sectionId);
  if (!decide) throw new ForbiddenError();
  const scale = await scaleFor(access.section.sessionId);
  const band = new Map(scale.bands.map((b) => [b.letter, b]));
  let after: () => void = () => undefined;
  const posted = await prisma.$transaction(
    async (tx) => {
      // Serialise concurrent approvals: the second one waits, then sees POSTED.
      await tx.$queryRaw`SELECT id FROM final_grade_submissions WHERE section_id = ${sectionId}::uuid FOR UPDATE`;
      const sub = await tx.finalGradeSubmission.findUnique({
        where: { sectionId },
        include: {
          entries: {
            include: {
              registration: {
                select: {
                  id: true,
                  status: true,
                  sectionId: true,
                  credits: true,
                  studentId: true,
                  courseId: true,
                  sessionId: true,
                  student: { select: { userId: true } },
                  course: { select: { code: true, title: true } },
                },
              },
            },
          },
        },
      });
      if (sub?.status !== 'SUBMITTED')
        throw new BusinessRuleError(
          ErrorCode.INVALID_STATE_TRANSITION,
          'Nothing is awaiting approval',
        );
      const notices: NewNotification[] = [];
      let count = 0;
      for (const e of sub.entries) {
        const r = e.registration;
        if (r.status !== 'REGISTERED') continue;
        const b = band.get(e.gradeLetter);
        if (!b)
          throw new BusinessRuleError(
            ErrorCode.VALIDATION_ERROR,
            `${e.gradeLetter} is no longer on the grading scale; return the sheet for correction`,
          );
        const credits = r.credits.toNumber();
        await tx.academicRecord.create({
          data: {
            studentId: r.studentId,
            courseId: r.courseId,
            sessionId: r.sessionId,
            registrationId: r.id,
            source: 'ENROLLMENT',
            courseCodeSnapshot: r.course.code,
            courseTitleSnapshot: r.course.title,
            creditsAttempted: credits,
            creditsEarned: b.isPassing ? credits : 0,
            gradeLetter: b.letter,
            gradePoints: b.gradePoints,
            countsInGpa: b.countsInGpa,
            passed: b.isPassing,
          },
        });
        await endRegistration(tx, r, 'COMPLETED', 'GRADE_POSTED', actor.userId, null, {
          grade: b.letter,
        });
        notices.push({
          userId: r.student.userId,
          category: 'GRADES',
          title: `Final grade posted: ${r.course.code}`,
          body: `Your final grade for ${r.course.code} ${r.course.title} is ${b.letter}.`,
          link: '/student/history',
        });
        count++;
      }
      const now = new Date();
      await tx.finalGradeSubmission.update({
        where: { sectionId },
        data: { status: 'POSTED', decidedById: actor.userId, decidedAt: now, postedAt: now },
      });
      if (sub.submittedById)
        notices.push({
          userId: sub.submittedById,
          category: 'GRADES',
          title: `Grades posted: ${access.section.course.code} ${access.section.sectionCode}`,
          body: `${count} final grade(s) were approved and posted.`,
          link: `/faculty/sections/${sectionId}?tab=grades`,
        });
      after = await queueNotifications(tx, notices);
      await recordAudit(
        actor,
        {
          action: 'grades.posted',
          entityType: 'CourseSection',
          entityId: sectionId,
          changes: { count },
        },
        tx,
      );
      return count;
    },
    { maxWait: 15_000, timeout: 120_000 },
  );
  after();
  return { posted, sheet: await gradeSheet(actor, sectionId) };
}

/** Sheets awaiting a decision (or in another state) within the approver's scope. */
export async function submissionQueue(actor: ActorContext, status: string) {
  if (!hasPermission(actor.grants, 'grade:approve')) throw new ForbiddenError();
  const scope = scopeFilter(actor.grants, 'grade:approve');
  const where: Prisma.FinalGradeSubmissionWhereInput = {
    status: status as never,
    ...(scope
      ? {
          section: {
            course: {
              OR: [
                { departmentId: { in: scope.departmentIds } },
                { department: { schoolId: { in: scope.schoolIds } } },
              ],
            },
          },
        }
      : {}),
  };
  const rows = await prisma.finalGradeSubmission.findMany({
    where,
    include: {
      section: {
        select: {
          id: true,
          sectionCode: true,
          course: { select: { code: true, title: true, department: { select: { code: true } } } },
          session: { select: { name: true } },
        },
      },
      submittedBy: { select: { firstName: true, lastName: true } },
      _count: { select: { entries: true } },
    },
    orderBy: [{ submittedAt: 'asc' }],
    take: 200,
  });
  return rows.map((s) => ({
    sectionId: s.section.id,
    label: `${s.section.course.code} ${s.section.sectionCode}`,
    title: s.section.course.title,
    department: s.section.course.department.code,
    session: s.section.session.name,
    status: s.status,
    grades: s._count.entries,
    submittedBy: s.submittedBy ? `${s.submittedBy.firstName} ${s.submittedBy.lastName}` : null,
    submittedAt: s.submittedAt?.toISOString() ?? null,
  }));
}

// ----- grade changes (FR-ACAD-006/009) --------------------------------------------------

async function recordScope(actor: ActorContext, recordId: string) {
  const r = await prisma.academicRecord.findUnique({
    where: { id: recordId },
    include: {
      course: { select: { departmentId: true, department: { select: { schoolId: true } } } },
      student: { select: { userId: true } },
    },
  });
  if (!r) throw new NotFoundError('Academic record');
  const target = { departmentId: r.course.departmentId, schoolId: r.course.department.schoolId };
  return { r, target };
}

/** Changes a posted grade with a reason; the old grade is kept as a version (never deleted). */
export async function changeGrade(
  actor: ActorContext,
  recordId: string,
  input: { gradeLetter: string; reason: string },
) {
  const { r, target } = await recordScope(actor, recordId);
  if (!covers(actor.grants, 'grade:change', target)) throw new NotFoundError('Academic record');
  if (!r.sessionId)
    throw new BusinessRuleError(
      ErrorCode.VALIDATION_ERROR,
      'Transfer and exemption records have no scale',
    );
  if (r.gradeLetter === input.gradeLetter)
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'That is already the grade');
  const scale = await scaleFor(r.sessionId);
  assertLetters([input.gradeLetter], scale.bands);
  const b = scale.bands.find((x) => x.letter === input.gradeLetter)!;
  let after: () => void = () => undefined;
  const updated = await prisma.$transaction(async (tx) => {
    const version = r.version + 1;
    await tx.gradeChange.create({
      data: {
        academicRecordId: r.id,
        version,
        fromLetter: r.gradeLetter,
        toLetter: b.letter,
        fromPoints: r.gradePoints,
        toPoints: b.gradePoints,
        reason: input.reason,
        changedById: actor.userId,
      },
    });
    const u = await tx.academicRecord.update({
      where: { id: r.id },
      data: {
        version,
        gradeLetter: b.letter,
        gradePoints: b.gradePoints,
        countsInGpa: b.countsInGpa,
        passed: b.isPassing,
        creditsEarned: b.isPassing ? r.creditsAttempted : 0,
      },
    });
    after = await queueNotifications(tx, [
      {
        userId: r.student.userId,
        category: 'GRADES',
        title: `Grade changed: ${r.courseCodeSnapshot}`,
        body: `Your grade for ${r.courseCodeSnapshot} changed from ${r.gradeLetter ?? '—'} to ${b.letter}.`,
        link: '/student/history',
      },
    ]);
    await recordAudit(
      actor,
      {
        action: 'grade.changed',
        entityType: 'AcademicRecord',
        entityId: r.id,
        changes: { from: r.gradeLetter, to: b.letter, reason: input.reason },
      },
      tx,
    );
    return u;
  });
  after();
  return gradeHistory(actor, updated.id);
}

/** The record with every grade version (record readers and grade changers in scope). */
export async function gradeHistory(actor: ActorContext, recordId: string) {
  const { r, target } = await recordScope(actor, recordId);
  const own = r.student.userId === actor.userId;
  if (!own && !covers(actor.grants, 'record:read', target))
    throw new NotFoundError('Academic record');
  const [changes, scale] = await Promise.all([
    prisma.gradeChange.findMany({
      where: { academicRecordId: recordId },
      include: { changedBy: { select: { firstName: true, lastName: true } } },
      orderBy: { version: 'asc' },
    }),
    r.sessionId ? scaleFor(r.sessionId) : Promise.resolve({ name: null, bands: [] }),
  ]);
  return {
    id: r.id,
    course: { code: r.courseCodeSnapshot, title: r.courseTitleSnapshot },
    gradeLetter: r.gradeLetter,
    gradePoints: r.gradePoints?.toNumber() ?? null,
    version: r.version,
    canChange: !own && covers(actor.grants, 'grade:change', target) && !!r.sessionId,
    letters: scale.bands.map((b) => b.letter),
    changes: changes.map((c) => ({
      version: c.version,
      from: c.fromLetter,
      to: c.toLetter,
      reason: c.reason,
      by: `${c.changedBy.firstName} ${c.changedBy.lastName}`,
      at: c.createdAt.toISOString(),
    })),
  };
}
