import type { Prisma } from '../../generated/prisma/client.js';
import { NotFoundError } from '../../common/exceptions/app-error.js';
import type { prisma } from '../../infrastructure/database/prisma.js';
import { restrictionDtos } from '../courses/courses.service.js';
import type { Restriction, RuleContext } from './rules.js';

export type Db = typeof prisma | Prisma.TransactionClient;

const meetingSelect = { select: { dayOfWeek: true, startMinute: true, endMinute: true } } as const;

/** Student facts the rules need. */
export async function loadStudent(db: Db, studentId: string) {
  const s = await db.student.findUnique({
    where: { id: studentId },
    include: {
      user: { select: { id: true, status: true, firstName: true, lastName: true } },
      program: { select: { departmentId: true } },
      holds: { where: { releasedAt: null }, select: { type: true, reason: true } },
    },
  });
  if (!s) throw new NotFoundError('Student');
  return s;
}

/**
 * Everything the rule pipeline reads for one student and one section. Call it
 * with the transaction client after taking the locks so decisions are made on
 * current data (ARCHITECTURE.md §8).
 */
export async function loadContext(
  db: Db,
  studentId: string,
  sectionId: string,
  options: { now?: Date; excludeRegistrationId?: string } = {},
): Promise<RuleContext> {
  const now = options.now ?? new Date();
  const [student, section] = await Promise.all([
    loadStudent(db, studentId),
    db.courseSection.findUnique({
      where: { id: sectionId },
      include: {
        meetings: meetingSelect,
        restrictions: true,
        course: {
          include: {
            restrictions: true,
            prerequisiteGroups: {
              orderBy: { position: 'asc' },
              include: {
                items: { include: { requiredCourse: { select: { id: true, code: true } } } },
              },
            },
            corequisites: { include: { corequisite: { select: { id: true, code: true } } } },
          },
        },
        session: {
          include: {
            policy: true,
            registrationPeriod: { include: { priorityWindows: true } },
            gradingScale: { include: { entries: { orderBy: { position: 'asc' } } } },
          },
        },
      },
    }),
  ]);
  if (!section) throw new NotFoundError('Section');
  const [records, current, inProgress, courseRules, sectionRules] = await Promise.all([
    db.academicRecord.findMany({
      where: { studentId, passed: true },
      select: { courseId: true, gradeLetter: true },
    }),
    db.courseRegistration.findMany({
      where: {
        studentId,
        sessionId: section.sessionId,
        status: { in: ['PENDING', 'REGISTERED', 'OFFERED', 'WAITLISTED'] },
        ...(options.excludeRegistrationId ? { id: { not: options.excludeRegistrationId } } : {}),
      },
      include: {
        course: { select: { code: true } },
        section: { select: { sectionCode: true, meetings: meetingSelect } },
      },
    }),
    db.courseRegistration.findMany({
      where: {
        studentId,
        sessionId: { not: section.sessionId },
        status: { in: ['REGISTERED', 'PENDING'] },
        session: { status: { in: ['ACTIVE', 'PLANNED'] } },
      },
      select: { courseId: true },
    }),
    restrictionDtos(section.course.restrictions),
    restrictionDtos(section.restrictions),
  ]);
  // Keep the best passed grade per course (by scale order).
  const order = section.session.gradingScale?.entries.map((e) => e.letter) ?? [];
  const passed = new Map<string, { gradeLetter: string | null }>();
  for (const r of records) {
    const prev = passed.get(r.courseId);
    const rank = (l: string | null) =>
      l === null ? -1 : order.indexOf(l) === -1 ? order.length : order.indexOf(l);
    if (!prev || rank(r.gradeLetter) < rank(prev.gradeLetter))
      passed.set(r.courseId, { gradeLetter: r.gradeLetter });
  }
  const policy = section.session.policy;
  const period = section.session.registrationPeriod;
  return {
    now,
    student: {
      id: student.id,
      userId: student.userId,
      status: student.status,
      accountStatus: student.user.status,
      programId: student.programId,
      departmentId: student.program.departmentId,
      specializationId: student.specializationId,
      yearOfStudy: student.yearOfStudy,
      cohort: student.cohort,
    },
    holds: student.holds,
    section: {
      id: section.id,
      sectionCode: section.sectionCode,
      status: section.status,
      registrationOpen: section.registrationOpen,
      capacity: section.capacity,
      enrolledCount: section.enrolledCount,
      waitlistCapacity: section.waitlistCapacity,
      waitlistCount: section.waitlistCount,
      meetings: section.meetings,
      restrictions: sectionRules as Restriction[],
    },
    course: {
      id: section.course.id,
      code: section.course.code,
      status: section.course.status,
      credits: section.course.credits.toNumber(),
      departmentId: section.course.departmentId,
      isRepeatable: section.course.isRepeatable,
      prerequisites: section.course.prerequisiteGroups.map((g) =>
        g.items.map((i) => ({
          courseId: i.requiredCourse.id,
          code: i.requiredCourse.code,
          minGradeLetter: i.minGradeLetter,
        })),
      ),
      corequisites: section.course.corequisites.map((c) => c.corequisite),
      restrictions: courseRules as Restriction[],
    },
    session: {
      id: section.session.id,
      status: section.session.status,
      policy: policy
        ? {
            maxCredits: policy.maxCredits.toNumber(),
            maxCreditsWithOverride: policy.maxCreditsWithOverride?.toNumber() ?? null,
            approvalMode: policy.approvalMode,
            waitlistEnabled: policy.waitlistEnabled,
            waitlistMaxPerSection: policy.waitlistMaxPerSection,
            countWaitlistInCredits: policy.countWaitlistInCredits,
            allowInProgressPrereqs: policy.allowInProgressPrereqs,
          }
        : null,
      period: period
        ? {
            opensAt: period.opensAt,
            closesAt: period.closesAt,
            lateClosesAt: period.lateClosesAt,
            windows: period.priorityWindows.map((w) => ({
              name: w.name,
              opensAt: w.opensAt,
              programId: w.programId,
              yearOfStudy: w.yearOfStudy,
              cohort: w.cohort,
            })),
          }
        : null,
      gradeOrder: order,
    },
    passed,
    inProgress: new Set(inProgress.map((r) => r.courseId)),
    current: current.map((r) => ({
      id: r.id,
      courseId: r.courseId,
      courseCode: r.course.code,
      sectionId: r.sectionId,
      sectionCode: r.section.sectionCode,
      status: r.status,
      credits: r.credits.toNumber(),
      meetings: r.section.meetings,
    })),
  };
}

/**
 * Re-reads the parts of a context that other transactions can change (seat
 * counters, section state, the student's registrations in the session). Used
 * inside the locks so the expensive static reads stay outside them.
 */
export async function refreshVolatile(
  db: Db,
  ctx: RuleContext,
  options: { excludeRegistrationId?: string } = {},
): Promise<RuleContext> {
  const [section, current, holds] = await Promise.all([
    db.courseSection.findUniqueOrThrow({
      where: { id: ctx.section.id },
      select: {
        status: true,
        registrationOpen: true,
        capacity: true,
        enrolledCount: true,
        waitlistCapacity: true,
        waitlistCount: true,
      },
    }),
    db.courseRegistration.findMany({
      where: {
        studentId: ctx.student.id,
        sessionId: ctx.session.id,
        status: { in: ['PENDING', 'REGISTERED', 'OFFERED', 'WAITLISTED'] },
        ...(options.excludeRegistrationId ? { id: { not: options.excludeRegistrationId } } : {}),
      },
      include: {
        course: { select: { code: true } },
        section: { select: { sectionCode: true, meetings: meetingSelect } },
      },
    }),
    db.registrationHold.findMany({
      where: { studentId: ctx.student.id, releasedAt: null },
      select: { type: true, reason: true },
    }),
  ]);
  return {
    ...ctx,
    now: new Date(),
    holds,
    section: { ...ctx.section, ...section },
    current: current.map((r) => ({
      id: r.id,
      courseId: r.courseId,
      courseCode: r.course.code,
      sectionId: r.sectionId,
      sectionCode: r.section.sectionCode,
      status: r.status,
      credits: r.credits.toNumber(),
      meetings: r.section.meetings,
    })),
  };
}
