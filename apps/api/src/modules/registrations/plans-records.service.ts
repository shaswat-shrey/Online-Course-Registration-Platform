import { ErrorCode } from '@ucrams/shared';
import type { ActorContext } from '../../common/context/actor.js';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { covers } from '../authz/authz.js';
import { loadContext } from './registration-context.js';
import { registerBatch, selfStudent } from './registrations.service.js';
import { evaluate } from './rules.js';

// ----- academic records (read side; grading in Phase 10) -------------------------

const recordDto = (r: {
  id: string;
  source: string;
  courseId: string;
  courseCodeSnapshot: string;
  courseTitleSnapshot: string;
  creditsAttempted: { toNumber(): number };
  creditsEarned: { toNumber(): number };
  gradeLetter: string | null;
  gradePoints: { toNumber(): number } | null;
  countsInGpa: boolean;
  passed: boolean;
  session: { id: string; code: string; name: string } | null;
}) => ({
  id: r.id,
  source: r.source,
  courseId: r.courseId,
  courseCode: r.courseCodeSnapshot,
  courseTitle: r.courseTitleSnapshot,
  creditsAttempted: r.creditsAttempted.toNumber(),
  creditsEarned: r.creditsEarned.toNumber(),
  gradeLetter: r.gradeLetter,
  gradePoints: r.gradePoints?.toNumber() ?? null,
  countsInGpa: r.countsInGpa,
  passed: r.passed,
  session: r.session,
});

async function recordsOf(studentId: string) {
  const rows = await prisma.academicRecord.findMany({
    where: { studentId },
    include: { session: { select: { id: true, code: true, name: true, startDate: true } } },
    orderBy: [{ session: { startDate: 'asc' } }, { courseCodeSnapshot: 'asc' }],
  });
  const records = rows.map((r) =>
    recordDto({
      ...r,
      session: r.session && { id: r.session.id, code: r.session.code, name: r.session.name },
    }),
  );
  // GPA only over GPA-counting records with grade points (FR-ACAD-008); repeat policy: all attempts.
  const gpaRows = rows.filter((r) => r.countsInGpa && r.gradePoints !== null);
  const credits = gpaRows.reduce((s, r) => s + r.creditsAttempted.toNumber(), 0);
  const points = gpaRows.reduce(
    (s, r) => s + r.gradePoints!.toNumber() * r.creditsAttempted.toNumber(),
    0,
  );
  return {
    records,
    creditsEarned: rows.reduce((s, r) => s + r.creditsEarned.toNumber(), 0),
    cgpa: credits ? Math.round((points / credits) * 100) / 100 : null,
  };
}

export async function myRecords(actor: ActorContext) {
  return recordsOf(await selfStudent(actor));
}

export async function studentRecords(actor: ActorContext, studentId: string) {
  const s = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      userId: true,
      program: { select: { departmentId: true, department: { select: { schoolId: true } } } },
    },
  });
  if (!s) throw new NotFoundError('Student');
  const own = s.userId === actor.userId;
  if (
    !own &&
    !covers(actor.grants, 'record:read', {
      departmentId: s.program.departmentId,
      schoolId: s.program.department.schoolId,
    })
  )
    throw new ForbiddenError();
  return recordsOf(studentId);
}

// ----- course plans (FR-STUDENT-008) ------------------------------------------------

const planInclude = {
  session: { select: { id: true, code: true, name: true } },
  items: {
    orderBy: { position: 'asc' as const },
    include: {
      course: { select: { id: true, code: true, title: true, credits: true } },
      section: { select: { id: true, sectionCode: true, status: true } },
    },
  },
} as const;

async function ownPlan(actor: ActorContext, id: string) {
  const studentId = await selfStudent(actor);
  const plan = await prisma.coursePlan.findUnique({ where: { id }, include: planInclude });
  if (!plan || plan.studentId !== studentId) throw new NotFoundError('Plan');
  return plan;
}

function planDto(p: Awaited<ReturnType<typeof ownPlan>>) {
  return {
    id: p.id,
    name: p.name,
    session: p.session,
    items: p.items.map((i) => ({
      course: {
        id: i.course.id,
        code: i.course.code,
        title: i.course.title,
        credits: i.course.credits.toNumber(),
      },
      section: i.section,
    })),
    totalCredits: p.items.reduce((s, i) => s + i.course.credits.toNumber(), 0),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function listPlans(actor: ActorContext, sessionId?: string) {
  const studentId = await selfStudent(actor);
  const plans = await prisma.coursePlan.findMany({
    where: { studentId, ...(sessionId ? { sessionId } : {}) },
    include: planInclude,
    orderBy: { updatedAt: 'desc' },
  });
  return plans.map(planDto);
}

export async function getPlan(actor: ActorContext, id: string) {
  return planDto(await ownPlan(actor, id));
}

export async function createPlan(actor: ActorContext, input: { sessionId: string; name: string }) {
  const studentId = await selfStudent(actor);
  if (!(await prisma.academicSession.findUnique({ where: { id: input.sessionId } })))
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Unknown session', {
      fields: [{ path: 'body.sessionId', message: 'Unknown session' }],
    });
  if (
    await prisma.coursePlan.findFirst({
      where: { studentId, sessionId: input.sessionId, name: input.name },
    })
  )
    throw new ConflictError(ErrorCode.UNIQUE_VIOLATION, 'You already have a plan with this name', {
      fields: [{ path: 'body.name', message: 'Already used' }],
    });
  const plan = await prisma.coursePlan.create({
    data: { studentId, ...input },
    include: planInclude,
  });
  return planDto(plan);
}

export async function setPlanItems(
  actor: ActorContext,
  id: string,
  items: Array<{ courseId: string; sectionId: string | null }>,
) {
  const plan = await ownPlan(actor, id);
  const sectionIds = items.flatMap((i) => (i.sectionId ? [i.sectionId] : []));
  const sections = await prisma.courseSection.findMany({ where: { id: { in: sectionIds } } });
  for (const i of items.filter((x) => x.sectionId)) {
    const s = sections.find((x) => x.id === i.sectionId);
    if (!s || s.courseId !== i.courseId || s.sessionId !== plan.session.id)
      throw new BusinessRuleError(
        ErrorCode.VALIDATION_ERROR,
        'A chosen section does not belong to that course and session',
      );
  }
  if (
    (await prisma.course.count({ where: { id: { in: items.map((i) => i.courseId) } } })) !==
    items.length
  )
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Unknown course in plan');
  await prisma.$transaction([
    prisma.coursePlanItem.deleteMany({ where: { planId: id } }),
    prisma.coursePlanItem.createMany({
      data: items.map((i, position) => ({ planId: id, ...i, position })),
    }),
    prisma.coursePlan.update({ where: { id }, data: { updatedAt: new Date() } }),
  ]);
  return getPlan(actor, id);
}

export async function deletePlan(actor: ActorContext, id: string) {
  await ownPlan(actor, id);
  await prisma.coursePlan.delete({ where: { id } });
}

/** Rule results per planned section, with plan items counted as one batch (FR-STUDENT-008). */
export async function validatePlan(actor: ActorContext, id: string) {
  const plan = await ownPlan(actor, id);
  const studentId = await selfStudent(actor);
  const batch = new Set(plan.items.map((i) => i.course.id));
  const items = [];
  for (const i of plan.items) {
    if (!i.section) {
      items.push({
        courseId: i.course.id,
        sectionId: null,
        ok: false,
        problems: [{ code: 'NO_SECTION', message: 'Choose a section' }],
      });
      continue;
    }
    const ctx = await loadContext(prisma, studentId, i.section.id);
    // Other plan items count towards credits and clashes as if registered.
    for (const other of plan.items) {
      if (other.course.id === i.course.id || !other.section) continue;
      const meetings = await prisma.sectionMeeting.findMany({
        where: { sectionId: other.section.id },
        select: { dayOfWeek: true, startMinute: true, endMinute: true },
      });
      ctx.current.push({
        id: `plan-${other.section.id}`,
        courseId: other.course.id,
        courseCode: other.course.code,
        sectionId: other.section.id,
        sectionCode: other.section.sectionCode,
        status: 'PENDING',
        credits: other.course.credits.toNumber(),
        meetings,
      });
    }
    const ev = evaluate(ctx, new Set(), { batchCourseIds: batch });
    const problems = ev.results
      .filter((r) => !r.ok)
      .map((r) => ({ code: r.code, message: r.message }));
    items.push({
      courseId: i.course.id,
      sectionId: i.section.id,
      ok: problems.length === 0,
      problems,
    });
  }
  return { planId: id, items, totalCredits: planDto(plan).totalCredits };
}

/** Registers every planned section in one call (each item independent). */
export async function registerPlan(actor: ActorContext, id: string) {
  const plan = await ownPlan(actor, id);
  const items = plan.items
    .filter((i) => i.section)
    .map((i) => ({ sectionId: i.section!.id, joinWaitlist: true }));
  if (!items.length)
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Choose sections before registering');
  return registerBatch(actor, items);
}
