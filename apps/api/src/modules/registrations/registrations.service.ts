import type { z } from 'zod';
import { ErrorCode, type adminRegisterSchema, type PermissionKey } from '@ucrams/shared';
import { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext } from '../../common/context/actor.js';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/exceptions/app-error.js';
import { paging } from '../../common/http/list-query.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import { covers, scopeFilter } from '../authz/authz.js';
import {
  queueNotifications,
  type NewNotification,
} from '../notifications/notifications.service.js';
import {
  endRegistration,
  enqueuePromotion,
  isSeat,
  lockSection,
  lockStudent,
  overrideSet,
  recordEvent,
  adjustCounters,
  ruleError,
  studentNotice,
  withRetry,
  type Tx,
  LOCKING_TX,
} from './registration-core.js';
import { loadContext, refreshVolatile } from './registration-context.js';
import { evaluate, waitlistLimit, type RuleResult } from './rules.js';

type Status = Prisma.CourseRegistrationCreateInput['status'];

// ----- access -------------------------------------------------------------------

/** The student record of the calling user (self-service endpoints). */
export async function selfStudent(actor: ActorContext) {
  const s = await prisma.student.findUnique({
    where: { userId: actor.userId },
    select: { id: true },
  });
  if (!s) throw new ForbiddenError('Only students can register for themselves');
  return s.id;
}

interface Targets {
  course: { departmentId: string; schoolId: string };
  student: { departmentId: string; schoolId: string };
}

/** Administrators act on a registration if their grant covers the course's or the student's department. */
function canAct(actor: ActorContext, permission: PermissionKey, t: Targets) {
  return covers(actor.grants, permission, t.course) || covers(actor.grants, permission, t.student);
}
function assertCanAct(actor: ActorContext, permission: PermissionKey, t: Targets) {
  if (!canAct(actor, permission, t)) throw new ForbiddenError();
}

async function targetsFor(studentId: string, sectionId: string): Promise<Targets> {
  const [student, section] = await Promise.all([
    prisma.student.findUnique({
      where: { id: studentId },
      select: {
        program: { select: { departmentId: true, department: { select: { schoolId: true } } } },
      },
    }),
    prisma.courseSection.findUnique({
      where: { id: sectionId },
      select: {
        course: { select: { departmentId: true, department: { select: { schoolId: true } } } },
      },
    }),
  ]);
  if (!student) throw new NotFoundError('Student');
  if (!section) throw new NotFoundError('Section');
  return {
    course: {
      departmentId: section.course.departmentId,
      schoolId: section.course.department.schoolId,
    },
    student: {
      departmentId: student.program.departmentId,
      schoolId: student.program.department.schoolId,
    },
  };
}

// ----- DTOs --------------------------------------------------------------------

const include = {
  student: {
    select: {
      id: true,
      studentNumber: true,
      userId: true,
      yearOfStudy: true,
      user: { select: { firstName: true, lastName: true, email: true } },
      program: { select: { code: true, name: true } },
    },
  },
  course: { select: { id: true, code: true, title: true, credits: true } },
  session: { select: { id: true, code: true, name: true } },
  section: {
    select: {
      id: true,
      sectionCode: true,
      status: true,
      meetings: {
        select: { dayOfWeek: true, startMinute: true, endMinute: true },
        orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
      },
      instructors: {
        where: { role: 'PRIMARY' },
        select: {
          facultyMember: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      },
    },
  },
  requests: {
    where: { status: 'PENDING' },
    select: { id: true, type: true, reason: true, createdAt: true },
  },
} satisfies Prisma.CourseRegistrationInclude;
type Row = Prisma.CourseRegistrationGetPayload<{ include: typeof include }>;

export function registrationDto(r: Row) {
  const instructor = r.section.instructors[0]?.facultyMember.user;
  return {
    id: r.id,
    status: r.status,
    credits: r.credits.toNumber(),
    student: {
      id: r.student.id,
      studentNumber: r.student.studentNumber,
      name: `${r.student.user.firstName} ${r.student.user.lastName}`,
      email: r.student.user.email,
      yearOfStudy: r.student.yearOfStudy,
      program: r.student.program,
    },
    course: {
      id: r.course.id,
      code: r.course.code,
      title: r.course.title,
      credits: r.course.credits.toNumber(),
    },
    section: {
      id: r.section.id,
      sectionCode: r.section.sectionCode,
      status: r.section.status,
      meetings: r.section.meetings,
      instructor: instructor ? `${instructor.firstName} ${instructor.lastName}` : null,
    },
    session: r.session,
    waitlistedAt: r.waitlistedAt?.toISOString() ?? null,
    offerExpiresAt: r.offerExpiresAt?.toISOString() ?? null,
    registeredAt: r.registeredAt?.toISOString() ?? null,
    endedAt: r.endedAt?.toISOString() ?? null,
    overrides: r.overrides,
    overrideReason: r.overrideReason,
    pendingRequest: r.requests[0]
      ? {
          id: r.requests[0].id,
          type: r.requests[0].type,
          reason: r.requests[0].reason,
          createdAt: r.requests[0].createdAt.toISOString(),
        }
      : null,
    createdAt: r.createdAt.toISOString(),
  };
}

async function load(id: string, db: Tx | typeof prisma = prisma) {
  const r = await db.courseRegistration.findUnique({ where: { id }, include });
  if (!r) throw new NotFoundError('Registration');
  return r;
}

/** Waitlist position (1-based) for a WAITLISTED registration. */
async function waitlistPosition(
  db: Tx | typeof prisma,
  r: { id: string; sectionId: string; waitlistedAt: Date | null },
) {
  if (!r.waitlistedAt) return null;
  const ahead = await db.courseRegistration.count({
    where: {
      sectionId: r.sectionId,
      status: 'WAITLISTED',
      OR: [
        { waitlistedAt: { lt: r.waitlistedAt } },
        { waitlistedAt: r.waitlistedAt, id: { lt: r.id } },
      ],
    },
  });
  return ahead + 1;
}

// ----- eligibility -------------------------------------------------------------

export async function eligibility(
  actor: ActorContext,
  input: { sectionId: string; studentId?: string },
) {
  let studentId: string;
  if (input.studentId) {
    assertCanAct(actor, 'registration:manage', await targetsFor(input.studentId, input.sectionId));
    studentId = input.studentId;
  } else studentId = await selfStudent(actor);
  const ctx = await loadContext(prisma, studentId, input.sectionId);
  const ev = evaluate(ctx);
  const outcome = ev.blocking
    ? 'BLOCKED'
    : ev.full
      ? ev.waitlistAvailable
        ? 'WAITLIST'
        : 'FULL'
      : ev.needsApproval
        ? 'PENDING'
        : 'REGISTER';
  return {
    sectionId: input.sectionId,
    studentId,
    eligible: outcome === 'REGISTER' || outcome === 'PENDING',
    outcome,
    rules: ev.results.map((r) => ({
      code: r.code,
      passed: r.ok,
      message: r.message,
      details: r.details ?? null,
      overridable: !r.ok && r.override ? r.override : null,
    })),
  };
}

// ----- submit ------------------------------------------------------------------

interface SubmitArgs {
  studentId: string;
  sectionId: string;
  joinWaitlist: boolean;
  actorUserId: string;
  /** Administrator acting on the student's behalf (no approval step, overrides allowed). */
  admin: boolean;
  overrides: string[];
  overrideReason: string | null;
  idempotencyKey?: string | null;
  batchCourseIds?: Set<string>;
}

/**
 * Seat allocation (FR-REG-014): student lock → section lock → re-evaluate every
 * rule on current data → insert + counter update + history, in one transaction.
 */
async function submit(args: SubmitArgs) {
  let afterCommit: () => void = () => undefined;
  const overrides = overrideSet(args.overrides);
  // Static context and a fail-fast pre-check outside any lock (ARCHITECTURE.md §8).
  const staticCtx = await loadContext(prisma, args.studentId, args.sectionId);
  if (!args.idempotencyKey) {
    const pre = evaluate(staticCtx, overrides, { batchCourseIds: args.batchCourseIds });
    if (pre.blocking) throw ruleError(pre.blocking);
    if (pre.full && !overrides.has('CAPACITY') && !args.joinWaitlist)
      throw ruleError(pre.results.find((r) => r.code === ErrorCode.SECTION_FULL)!);
  }
  const result = await withRetry(() =>
    prisma.$transaction(async (tx) => {
      await lockStudent(tx, args.studentId);
      if (args.idempotencyKey) {
        const seen = await tx.courseRegistration.findUnique({
          where: {
            studentId_idempotencyKey: {
              studentId: args.studentId,
              idempotencyKey: args.idempotencyKey,
            },
          },
        });
        if (seen) {
          if (seen.sectionId !== args.sectionId)
            throw new ConflictError(
              ErrorCode.CONFLICT,
              'This idempotency key was used for a different request',
            );
          return { id: seen.id, replay: true };
        }
      }
      await lockSection(tx, args.sectionId);
      const ctx = await refreshVolatile(tx, staticCtx);
      const ev = evaluate(ctx, overrides, { batchCourseIds: args.batchCourseIds });
      if (ev.blocking) throw ruleError(ev.blocking);

      let status: Status;
      const seatResult = ev.results.find((r) => r.code === ErrorCode.SECTION_FULL)!;
      if (ev.full && overrides.has('CAPACITY')) {
        // An over-capacity override raises capacity rather than bypassing the constraint (FR-REG-014).
        await tx.$executeRaw`UPDATE course_sections SET capacity = enrolled_count + 1 WHERE id = ${args.sectionId}::uuid`;
        status = 'REGISTERED';
      } else if (ev.full) {
        if (!args.joinWaitlist) throw ruleError(seatResult);
        const limit = waitlistLimit(ctx);
        if (limit === 0)
          throw new BusinessRuleError(ErrorCode.WAITLIST_DISABLED, 'This section has no waitlist');
        if (!ev.waitlistAvailable)
          throw new ConflictError(ErrorCode.WAITLIST_FULL, 'The waitlist is full', {
            waitlistCapacity: limit,
          });
        status = 'WAITLISTED';
      } else status = !args.admin && ev.needsApproval ? 'PENDING' : 'REGISTERED';

      const now = new Date();
      let reg;
      try {
        reg = await tx.courseRegistration.create({
          data: {
            studentId: args.studentId,
            sectionId: args.sectionId,
            courseId: ctx.course.id,
            sessionId: ctx.session.id,
            status,
            credits: ctx.course.credits,
            waitlistedAt: status === 'WAITLISTED' ? now : null,
            registeredAt: status === 'REGISTERED' ? now : null,
            idempotencyKey: args.idempotencyKey ?? null,
            overrides: args.overrides,
            overrideReason: args.overrides.length ? args.overrideReason : null,
            createdById: args.actorUserId,
          },
        });
      } catch (err) {
        // The partial unique index is the last line of defence (BR-002).
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
          throw new ConflictError(
            ErrorCode.DUPLICATE_REGISTRATION,
            'Already registered for this course in this session',
          );
        throw err;
      }
      await adjustCounters(
        tx,
        args.sectionId,
        status === 'WAITLISTED' ? { waitlist: 1 } : { enrolled: 1 },
      );
      const late = ev.results.some((r) => r.details?.late);
      await recordEvent(tx, {
        registrationId: reg.id,
        from: null,
        to: status,
        action:
          status === 'WAITLISTED'
            ? 'WAITLISTED'
            : status === 'PENDING'
              ? 'REQUESTED'
              : 'REGISTERED',
        actorId: args.actorUserId,
        reason: args.overrides.length ? args.overrideReason : null,
        details: {
          ...(args.overrides.length ? { overrides: args.overrides } : {}),
          ...(late ? { late: true } : {}),
          ...(args.admin ? { onBehalf: true } : {}),
        },
      });
      const sec = `${ctx.course.code} ${ctx.section.sectionCode}`;
      const position = status === 'WAITLISTED' ? await waitlistPosition(tx, reg) : null;
      const message: Record<string, [string, string, NewNotification['category']]> = {
        REGISTERED: [`Registered in ${sec}`, `Your seat in ${sec} is confirmed.`, 'REGISTRATION'],
        PENDING: [
          `${sec} awaits approval`,
          `Your registration in ${sec} holds a seat and needs approval${late ? ' (late registration)' : ''}.`,
          'REGISTRATION',
        ],
        WAITLISTED: [
          `Waitlisted for ${sec}`,
          `You are number ${position} on the waitlist for ${sec}.`,
          'WAITLIST',
        ],
      };
      const [title, body, category] = message[status]!;
      afterCommit = await queueNotifications(tx, [
        studentNotice(ctx.student.userId, title, body, category),
      ]);
      return { id: reg.id, replay: false };
    }, LOCKING_TX),
  );
  afterCommit();
  const row = await load(result.id);
  return {
    ...registrationDto(row),
    waitlistPosition: await waitlistPosition(prisma, row),
    replay: result.replay,
  };
}

export async function registerSelf(
  actor: ActorContext,
  input: { sectionId: string; joinWaitlist: boolean },
  idempotencyKey: string | null,
) {
  const studentId = await selfStudent(actor);
  return submit({
    studentId,
    sectionId: input.sectionId,
    joinWaitlist: input.joinWaitlist,
    actorUserId: actor.userId,
    admin: false,
    overrides: [],
    overrideReason: null,
    idempotencyKey,
  });
}

/** Administrative registration with selected rule overrides (FR-ADMIN-022, FR-REG-026). */
export async function registerOnBehalf(
  actor: ActorContext,
  input: z.output<typeof adminRegisterSchema>,
) {
  const targets = await targetsFor(input.studentId, input.sectionId);
  assertCanAct(actor, 'registration:manage', targets);
  if (input.overrides.length) assertCanAct(actor, 'registration:override', targets);
  const result = await submit({
    studentId: input.studentId,
    sectionId: input.sectionId,
    joinWaitlist: input.joinWaitlist,
    actorUserId: actor.userId,
    admin: true,
    overrides: input.overrides,
    overrideReason: input.reason,
  });
  await recordAudit(actor, {
    action: input.overrides.length
      ? 'registration.created_with_override'
      : 'registration.created_on_behalf',
    entityType: 'CourseRegistration',
    entityId: result.id,
    changes: {
      studentId: input.studentId,
      sectionId: input.sectionId,
      status: result.status,
      overrides: input.overrides,
      reason: input.reason,
    },
  });
  return result;
}

/** Planner/batch submission: each item independently, corequisites in the batch count (FR-REG-025). */
export async function registerBatch(
  actor: ActorContext,
  items: Array<{ sectionId: string; joinWaitlist: boolean }>,
) {
  const studentId = await selfStudent(actor);
  const sections = await prisma.courseSection.findMany({
    where: { id: { in: items.map((i) => i.sectionId) } },
    select: { id: true, courseId: true },
  });
  const courseOf = new Map(sections.map((s) => [s.id, s.courseId]));
  const batchCourseIds = new Set(sections.map((s) => s.courseId));
  // Deterministic order: by section id (also the lock order).
  const ordered = [...items].sort((a, b) => a.sectionId.localeCompare(b.sectionId));
  const results = [];
  for (const item of ordered) {
    if (!courseOf.has(item.sectionId)) {
      results.push({
        sectionId: item.sectionId,
        ok: false,
        error: { code: ErrorCode.NOT_FOUND, message: 'Section not found' },
      });
      continue;
    }
    try {
      const reg = await submit({
        studentId,
        sectionId: item.sectionId,
        joinWaitlist: item.joinWaitlist,
        actorUserId: actor.userId,
        admin: false,
        overrides: [],
        overrideReason: null,
        batchCourseIds,
      });
      results.push({ sectionId: item.sectionId, ok: true, registration: reg });
    } catch (err) {
      const e = err as { code?: string; message: string; details?: unknown };
      if (!e.code) throw err;
      results.push({
        sectionId: item.sectionId,
        ok: false,
        error: { code: e.code, message: e.message, details: e.details ?? null },
      });
    }
  }
  return {
    results,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  };
}

// ----- drop / withdraw / cancel ------------------------------------------------

async function periodOf(sessionId: string) {
  return prisma.registrationPeriod.findUnique({ where: { sessionId } });
}

interface ActingAs {
  self: boolean;
  targets: Targets;
}
async function actingAs(
  actor: ActorContext,
  reg: { studentId: string; sectionId: string; student: { userId: string } },
  permission: PermissionKey,
): Promise<ActingAs> {
  const targets = await targetsFor(reg.studentId, reg.sectionId);
  if (reg.student.userId === actor.userId && (actor.grants['registration:self']?.length ?? 0) > 0)
    return { self: true, targets };
  assertCanAct(actor, permission, targets);
  return { self: false, targets };
}

/**
 * Drop a seat (before add/drop), leave a waitlist, cancel a pending request or
 * decline an offer (FR-REG-017/019/024). `alsoDrop` drops corequisite partners together.
 */
export async function dropRegistration(
  actor: ActorContext,
  id: string,
  input: { reason: string | null; alsoDrop: string[]; overrides: string[] },
) {
  const first = await load(id);
  const as = await actingAs(actor, first, 'registration:manage');
  if (input.overrides.length) {
    if (as.self) throw new ForbiddenError('Overrides are for administrators');
    assertCanAct(actor, 'registration:override', as.targets);
  }
  const ids = [id, ...input.alsoDrop.filter((x) => x !== id)];
  const regs = await prisma.courseRegistration.findMany({
    where: { id: { in: ids } },
    include: {
      course: { select: { code: true } },
      section: { select: { sectionCode: true } },
      student: { select: { userId: true } },
    },
  });
  if (
    regs.length !== ids.length ||
    regs.some((r) => r.studentId !== first.studentId || r.sessionId !== first.sessionId)
  )
    throw new BusinessRuleError(
      ErrorCode.VALIDATION_ERROR,
      'Registrations dropped together must be the same student’s in one session',
    );
  const period = await periodOf(first.sessionId);
  const now = new Date();
  for (const r of regs) {
    if (!['REGISTERED', 'PENDING', 'WAITLISTED', 'OFFERED'].includes(r.status))
      throw new BusinessRuleError(
        ErrorCode.INVALID_STATE_TRANSITION,
        `${r.course.code} is ${r.status.toLowerCase()} and cannot be dropped`,
      );
    if (
      r.status === 'REGISTERED' &&
      !input.overrides.includes('PERIOD') &&
      (!period || now > period.addDropDeadline)
    )
      throw new BusinessRuleError(
        ErrorCode.ADD_DROP_DEADLINE_PASSED,
        'The add/drop deadline has passed; withdraw instead',
        {
          deadline: period?.addDropDeadline.toISOString() ?? null,
        },
      );
  }
  // FR-REG-019 / BR-008: a seat another registration depends on as a corequisite.
  if (!input.overrides.includes('COREQUISITE')) {
    const dropping = new Set(regs.filter((r) => isSeat(r.status)).map((r) => r.courseId));
    if (dropping.size) {
      const dependants = await prisma.courseRegistration.findMany({
        where: {
          studentId: first.studentId,
          sessionId: first.sessionId,
          status: { in: ['REGISTERED', 'PENDING', 'OFFERED'] },
          id: { notIn: ids },
          course: { corequisites: { some: { corequisiteId: { in: [...dropping] } } } },
        },
        include: { course: { select: { code: true } } },
      });
      if (dependants.length)
        throw new BusinessRuleError(
          ErrorCode.COREQUISITE_DEPENDENCY,
          `${dependants.map((d) => d.course.code).join(', ')} requires this course in the same session; drop them together`,
          {
            dependants: dependants.map((d) => ({
              registrationId: d.id,
              courseCode: d.course.code,
            })),
          },
        );
    }
  }
  const freed = new Set<string>();
  let afterCommit: () => void = () => undefined;
  await withRetry(() =>
    prisma.$transaction(async (tx) => {
      await lockStudent(tx, first.studentId);
      for (const sid of [...new Set(regs.map((r) => r.sectionId))].sort())
        await lockSection(tx, sid);
      const notices: NewNotification[] = [];
      for (const r of regs) {
        const current = await tx.courseRegistration.findUniqueOrThrow({ where: { id: r.id } });
        const [to, action, verb]: [Status, string, string] =
          current.status === 'REGISTERED'
            ? ['DROPPED', 'DROPPED', 'Dropped']
            : current.status === 'WAITLISTED'
              ? ['CANCELLED', 'LEFT_WAITLIST', 'Left the waitlist for']
              : current.status === 'OFFERED'
                ? ['CANCELLED', 'OFFER_DECLINED', 'Declined the seat in']
                : current.status === 'PENDING'
                  ? ['CANCELLED', 'CANCELLED', 'Cancelled the request for']
                  : (() => {
                      throw new BusinessRuleError(
                        ErrorCode.INVALID_STATE_TRANSITION,
                        'This registration changed; reload and try again',
                      );
                    })();
        const seat = await endRegistration(tx, current, to, action, actor.userId, input.reason, {
          ...(as.self ? {} : { onBehalf: true }),
          ...(input.overrides.length ? { overrides: input.overrides } : {}),
        });
        if (seat) freed.add(current.sectionId);
        notices.push(
          studentNotice(
            r.student.userId,
            `${verb} ${r.course.code} ${r.section.sectionCode}`,
            as.self
              ? 'Your change was saved.'
              : `An administrator made this change${input.reason ? `: ${input.reason}` : '.'}`,
          ),
        );
      }
      afterCommit = await queueNotifications(tx, notices);
    }),
  );
  afterCommit();
  for (const s of freed) await enqueuePromotion(s);
  if (!as.self)
    await recordAudit(actor, {
      action: 'registration.dropped_on_behalf',
      entityType: 'CourseRegistration',
      entityId: id,
      changes: { ids, reason: input.reason, overrides: input.overrides },
    });
  return Promise.all(ids.map(async (x) => registrationDto(await load(x))));
}

/** Withdrawal after add/drop and before the withdrawal deadline (FR-REG-018). */
export async function withdrawRegistration(
  actor: ActorContext,
  id: string,
  input: { reason: string | null; overrides: string[] },
) {
  const reg = await load(id);
  const as = await actingAs(actor, reg, 'registration:manage');
  if (input.overrides.length) {
    if (as.self) throw new ForbiddenError('Overrides are for administrators');
    assertCanAct(actor, 'registration:override', as.targets);
  }
  if (reg.status !== 'REGISTERED')
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      'Only registered courses can be withdrawn from',
    );
  const period = await periodOf(reg.sessionId);
  const now = new Date();
  if (!input.overrides.includes('PERIOD')) {
    if (period && now <= period.addDropDeadline)
      throw new BusinessRuleError(
        ErrorCode.INVALID_STATE_TRANSITION,
        'Add/drop is still open: drop the course instead',
      );
    if (!period || now > period.withdrawalDeadline)
      throw new BusinessRuleError(
        ErrorCode.WITHDRAWAL_DEADLINE_PASSED,
        'The withdrawal deadline has passed',
        {
          deadline: period?.withdrawalDeadline.toISOString() ?? null,
        },
      );
  }
  const policy = await prisma.sessionPolicy.findUnique({ where: { sessionId: reg.sessionId } });
  if (as.self && policy?.withdrawalRequiresApproval) {
    if (reg.requests.some((r) => r.type === 'WITHDRAWAL'))
      throw new ConflictError(ErrorCode.CONFLICT, 'A withdrawal request is already pending');
    await prisma.registrationRequest.create({
      data: { registrationId: id, type: 'WITHDRAWAL', reason: input.reason },
    });
    return registrationDto(await load(id));
  }
  let afterCommit: () => void = () => undefined;
  await withRetry(() =>
    prisma.$transaction(async (tx) => {
      await lockStudent(tx, reg.studentId);
      await lockSection(tx, reg.sectionId);
      const current = await tx.courseRegistration.findUniqueOrThrow({ where: { id } });
      if (current.status !== 'REGISTERED')
        throw new BusinessRuleError(
          ErrorCode.INVALID_STATE_TRANSITION,
          'This registration changed; reload and try again',
        );
      await endRegistration(
        tx,
        current,
        'WITHDRAWN',
        'WITHDRAWN',
        actor.userId,
        input.reason,
        as.self ? undefined : { onBehalf: true, overrides: input.overrides },
      );
      afterCommit = await queueNotifications(tx, [
        studentNotice(
          reg.student.userId,
          `Withdrawn from ${reg.course.code} ${reg.section.sectionCode}`,
          'Your transcript will show W for this course; it earns no credits.',
        ),
      ]);
    }),
  );
  afterCommit();
  if (!as.self)
    await recordAudit(actor, {
      action: 'registration.withdrawn_on_behalf',
      entityType: 'CourseRegistration',
      entityId: id,
      changes: { reason: input.reason, overrides: input.overrides },
    });
  return registrationDto(await load(id));
}

// ----- approvals ---------------------------------------------------------------

/** Approve or reject a PENDING registration (FR-REG-016, FR-ADMIN-021). */
export async function decideRegistration(
  actor: ActorContext,
  id: string,
  input: { decision: 'APPROVE' | 'REJECT'; note: string | null },
) {
  const reg = await load(id);
  assertCanAct(actor, 'registration:approve', await targetsFor(reg.studentId, reg.sectionId));
  let freed = false;
  let afterCommit: () => void = () => undefined;
  await withRetry(() =>
    prisma.$transaction(async (tx) => {
      await lockStudent(tx, reg.studentId);
      await lockSection(tx, reg.sectionId);
      const current = await tx.courseRegistration.findUniqueOrThrow({ where: { id } });
      if (current.status !== 'PENDING')
        throw new BusinessRuleError(
          ErrorCode.INVALID_STATE_TRANSITION,
          `This registration is ${current.status.toLowerCase()}, not pending`,
        );
      const sec = `${reg.course.code} ${reg.section.sectionCode}`;
      if (input.decision === 'APPROVE') {
        await tx.courseRegistration.update({
          where: { id },
          data: { status: 'REGISTERED', registeredAt: new Date() },
        });
        await recordEvent(tx, {
          registrationId: id,
          from: 'PENDING',
          to: 'REGISTERED',
          action: 'APPROVED',
          actorId: actor.userId,
          reason: input.note,
        });
        afterCommit = await queueNotifications(tx, [
          studentNotice(reg.student.userId, `${sec} approved`, 'Your registration is confirmed.'),
        ]);
      } else {
        freed = await endRegistration(
          tx,
          current,
          'REJECTED',
          'REJECTED',
          actor.userId,
          input.note,
        );
        afterCommit = await queueNotifications(tx, [
          studentNotice(
            reg.student.userId,
            `${sec} not approved`,
            input.note ?? 'Your registration request was declined.',
          ),
        ]);
      }
    }),
  );
  afterCommit();
  if (freed) await enqueuePromotion(reg.sectionId);
  await recordAudit(actor, {
    action: input.decision === 'APPROVE' ? 'registration.approved' : 'registration.rejected',
    entityType: 'CourseRegistration',
    entityId: id,
    changes: { note: input.note },
  });
  return registrationDto(await load(id));
}

export async function decideMany(
  actor: ActorContext,
  input: { ids: string[]; decision: 'APPROVE' | 'REJECT'; note: string | null },
) {
  const results = [];
  for (const id of input.ids) {
    try {
      const r = await decideRegistration(actor, id, input);
      results.push({ id, ok: true, status: r.status });
    } catch (err) {
      const e = err as { code?: string; message: string };
      if (!e.code) throw err;
      results.push({ id, ok: false, error: { code: e.code, message: e.message } });
    }
  }
  return {
    results,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  };
}

/** Decide a withdrawal request (policy requires approval). */
export async function decideRequest(
  actor: ActorContext,
  requestId: string,
  input: { decision: 'APPROVE' | 'REJECT'; note: string | null },
) {
  const req = await prisma.registrationRequest.findUnique({ where: { id: requestId } });
  if (!req) throw new NotFoundError('Request');
  const reg = await load(req.registrationId);
  assertCanAct(actor, 'registration:approve', await targetsFor(reg.studentId, reg.sectionId));
  let afterCommit: () => void = () => undefined;
  await prisma.$transaction(async (tx) => {
    const current = await tx.registrationRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (current.status !== 'PENDING')
      throw new BusinessRuleError(
        ErrorCode.INVALID_STATE_TRANSITION,
        'This request has already been decided',
      );
    await tx.registrationRequest.update({
      where: { id: requestId },
      data: {
        status: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        decidedById: actor.userId,
        decisionNote: input.note,
        decidedAt: new Date(),
      },
    });
    const sec = `${reg.course.code} ${reg.section.sectionCode}`;
    if (input.decision === 'APPROVE') {
      await lockStudent(tx, reg.studentId);
      await lockSection(tx, reg.sectionId);
      const r = await tx.courseRegistration.findUniqueOrThrow({ where: { id: reg.id } });
      if (r.status !== 'REGISTERED')
        throw new BusinessRuleError(
          ErrorCode.INVALID_STATE_TRANSITION,
          'The registration is no longer active',
        );
      await endRegistration(tx, r, 'WITHDRAWN', 'WITHDRAWN', actor.userId, req.reason, {
        requestId,
        approvedBy: actor.userId,
      });
      afterCommit = await queueNotifications(tx, [
        studentNotice(
          reg.student.userId,
          `Withdrawal from ${sec} approved`,
          'Your transcript will show W for this course.',
        ),
      ]);
    } else {
      afterCommit = await queueNotifications(tx, [
        studentNotice(
          reg.student.userId,
          `Withdrawal from ${sec} declined`,
          input.note ?? 'You remain registered.',
        ),
      ]);
    }
  });
  afterCommit();
  await recordAudit(actor, {
    action:
      input.decision === 'APPROVE'
        ? 'registration.withdrawal_approved'
        : 'registration.withdrawal_rejected',
    entityType: 'RegistrationRequest',
    entityId: requestId,
    changes: { note: input.note },
  });
  return registrationDto(await load(reg.id));
}

// ----- reads -------------------------------------------------------------------

export interface RegistrationListQuery {
  page: number;
  limit: number;
  q?: string;
  sessionId?: string;
  status?: string;
  departmentId?: string;
  courseId?: string;
  sectionId?: string;
  studentId?: string;
  from?: string;
  to?: string;
  hasOverrides?: boolean;
}

/** Scope: administrators by the course's or student's department; others see their own. */
function listScope(actor: ActorContext): Prisma.CourseRegistrationWhereInput {
  const grants = actor.grants['registration:read']?.filter((g) => g.scope !== 'OWN') ?? [];
  if (!grants.length) return { student: { userId: actor.userId } };
  const filter = scopeFilter(actor.grants, 'registration:read');
  if (!filter) return {};
  const dept = {
    OR: [{ id: { in: filter.departmentIds } }, { schoolId: { in: filter.schoolIds } }],
  };
  return { OR: [{ course: { department: dept } }, { student: { program: { department: dept } } }] };
}

export async function listRegistrations(actor: ActorContext, q: RegistrationListQuery) {
  const and: Prisma.CourseRegistrationWhereInput[] = [listScope(actor)];
  if (q.sessionId) and.push({ sessionId: q.sessionId });
  if (q.status) and.push({ status: q.status as Status });
  if (q.departmentId) and.push({ course: { departmentId: q.departmentId } });
  if (q.courseId) and.push({ courseId: q.courseId });
  if (q.sectionId) and.push({ sectionId: q.sectionId });
  if (q.studentId) and.push({ studentId: q.studentId });
  if (q.hasOverrides) and.push({ NOT: { overrides: { isEmpty: true } } });
  if (q.from || q.to)
    and.push({
      createdAt: {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999Z`) } : {}),
      },
    });
  if (q.q)
    and.push({
      OR: [
        { student: { studentNumber: { contains: q.q, mode: 'insensitive' } } },
        { student: { user: { lastName: { contains: q.q, mode: 'insensitive' } } } },
        { student: { user: { firstName: { contains: q.q, mode: 'insensitive' } } } },
        { course: { code: { contains: q.q, mode: 'insensitive' } } },
      ],
    });
  const where = { AND: and };
  const [total, rows] = await Promise.all([
    prisma.courseRegistration.count({ where }),
    prisma.courseRegistration.findMany({
      where,
      include,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...paging(q),
    }),
  ]);
  return { total, items: rows.map(registrationDto) };
}

export async function getRegistration(actor: ActorContext, id: string) {
  const r = await load(id);
  const own = r.student.userId === actor.userId;
  if (!own && !canAct(actor, 'registration:read', await targetsFor(r.studentId, r.sectionId)))
    throw new NotFoundError('Registration');
  const events = await prisma.registrationEvent.findMany({
    where: { registrationId: id },
    orderBy: { createdAt: 'asc' },
    include: { actor: { select: { firstName: true, lastName: true } } },
  });
  return {
    ...registrationDto(r),
    waitlistPosition: r.status === 'WAITLISTED' ? await waitlistPosition(prisma, r) : null,
    history: events.map((e) => ({
      id: e.id,
      from: e.fromStatus,
      to: e.toStatus,
      action: e.action,
      actor: e.actor ? `${e.actor.firstName} ${e.actor.lastName}` : 'System',
      reason: e.reason,
      details: e.details,
      at: e.createdAt.toISOString(),
    })),
  };
}

/** The caller's registrations in a session, with waitlist positions and credit total. */
export async function myRegistrations(actor: ActorContext, sessionId?: string) {
  const studentId = await selfStudent(actor);
  const rows = await prisma.courseRegistration.findMany({
    where: { studentId, ...(sessionId ? { sessionId } : {}) },
    include,
    orderBy: [{ session: { startDate: 'desc' } }, { course: { code: 'asc' } }],
  });
  const items = await Promise.all(
    rows.map(async (r) => ({
      ...registrationDto(r),
      waitlistPosition: r.status === 'WAITLISTED' ? await waitlistPosition(prisma, r) : null,
    })),
  );
  const credits = items.filter((i) => isSeat(i.status)).reduce((s, i) => s + i.credits, 0);
  return { items, seatCredits: credits };
}

/** Seat holders and the ordered waitlist of a section (administrators). */
export async function sectionRegistrations(actor: ActorContext, sectionId: string) {
  const section = await prisma.courseSection.findUnique({
    where: { id: sectionId },
    select: {
      id: true,
      capacity: true,
      enrolledCount: true,
      waitlistCount: true,
      course: { select: { departmentId: true, department: { select: { schoolId: true } } } },
    },
  });
  if (!section) throw new NotFoundError('Section');
  const target = {
    departmentId: section.course.departmentId,
    schoolId: section.course.department.schoolId,
  };
  if (!covers(actor.grants, 'registration:read', target)) throw new ForbiddenError();
  const rows = await prisma.courseRegistration.findMany({
    where: { sectionId, status: { in: ['PENDING', 'REGISTERED', 'OFFERED', 'WAITLISTED'] } },
    include,
    orderBy: [{ waitlistedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
  const seats = rows.filter((r) => r.status !== 'WAITLISTED').map(registrationDto);
  const waitlist = rows
    .filter((r) => r.status === 'WAITLISTED')
    .map((r, i) => ({ ...registrationDto(r), waitlistPosition: i + 1 }));
  return {
    capacity: section.capacity,
    enrolledCount: section.enrolledCount,
    waitlistCount: section.waitlistCount,
    seats,
    waitlist,
    canManage: covers(actor.grants, 'registration:manage', target),
    canManageWaitlist: covers(actor.grants, 'waitlist:manage', target),
    canApprove: covers(actor.grants, 'registration:approve', target),
  };
}

export async function listRequests(
  actor: ActorContext,
  q: { page: number; limit: number; status?: string },
) {
  const where: Prisma.RegistrationRequestWhereInput = {
    ...(q.status ? { status: q.status as never } : {}),
    registration: listScope(actor),
  };
  const [total, rows] = await Promise.all([
    prisma.registrationRequest.count({ where }),
    prisma.registrationRequest.findMany({
      where,
      include: { registration: { include } },
      orderBy: { createdAt: 'asc' },
      ...paging(q),
    }),
  ]);
  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      reason: r.reason,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
      registration: registrationDto(r.registration),
    })),
  };
}

export type { RuleResult };
