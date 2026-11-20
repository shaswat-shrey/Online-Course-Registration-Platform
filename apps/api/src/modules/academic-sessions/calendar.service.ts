import type { z } from 'zod';
import {
  ErrorCode,
  type academicSessionCreateSchema,
  type academicSessionUpdateSchema,
  type academicYearCreateSchema,
  type academicYearUpdateSchema,
  type priorityWindowSchema,
  type registrationPeriodSchema,
  type sessionPolicySchema,
} from '@ucrams/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext } from '../../common/context/actor.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../common/exceptions/app-error.js';
import { isoDate, num } from '../../common/http/list-query.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { diffChanges, recordAudit } from '../audit/audit.service.js';
import { assertGlobal } from '../authz/authz.js';
import { hasDependents } from '../structure-scope.js';

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const invalidField = (path: string, message: string) =>
  new BusinessRuleError(ErrorCode.VALIDATION_ERROR, message, {
    fields: [{ path: `body.${path}`, message }],
  });

// ----- academic years --------------------------------------------------------

type YearRow = Prisma.AcademicYearGetPayload<{
  include: { _count: { select: { sessions: true } } };
}>;
const yearDto = (y: YearRow) => ({
  id: y.id,
  label: y.label,
  startDate: isoDate(y.startDate),
  endDate: isoDate(y.endDate),
  sessionCount: y._count.sessions,
});
const yearInclude = { _count: { select: { sessions: true } } } as const;

export async function listYears() {
  const rows = await prisma.academicYear.findMany({
    orderBy: { startDate: 'desc' },
    include: yearInclude,
  });
  return rows.map(yearDto);
}

export async function createYear(
  actor: ActorContext,
  input: z.output<typeof academicYearCreateSchema>,
) {
  assertGlobal(actor, 'session:manage');
  const label = input.label.replace('–', '-');
  if (await prisma.academicYear.findUnique({ where: { label } })) {
    throw new ConflictError(ErrorCode.UNIQUE_VIOLATION, 'This academic year already exists', {
      fields: [{ path: 'body.label', message: 'Already exists' }],
    });
  }
  return prisma.$transaction(async (tx) => {
    const y = await tx.academicYear.create({
      data: { label, startDate: day(input.startDate), endDate: day(input.endDate) },
      include: yearInclude,
    });
    await recordAudit(
      actor,
      {
        action: 'academic_year.created',
        entityType: 'AcademicYear',
        entityId: y.id,
        changes: input as never,
      },
      tx,
    );
    return yearDto(y);
  });
}

export async function updateYear(
  actor: ActorContext,
  id: string,
  input: z.output<typeof academicYearUpdateSchema>,
) {
  assertGlobal(actor, 'session:manage');
  const before = await prisma.academicYear.findUnique({ where: { id } });
  if (!before) throw new NotFoundError('Academic year');
  const start = input.startDate ? day(input.startDate) : before.startDate;
  const end = input.endDate ? day(input.endDate) : before.endDate;
  if (start >= end) throw invalidField('endDate', 'End date must be after the start date');
  const outside = await prisma.academicSession.count({
    where: { academicYearId: id, OR: [{ startDate: { lt: start } }, { endDate: { gt: end } }] },
  });
  if (outside > 0)
    throw invalidField('startDate', `${outside} session(s) would fall outside the new dates`);
  return prisma.$transaction(async (tx) => {
    const y = await tx.academicYear.update({
      where: { id },
      data: { label: input.label?.replace('–', '-'), startDate: start, endDate: end },
      include: yearInclude,
    });
    await recordAudit(
      actor,
      {
        action: 'academic_year.updated',
        entityType: 'AcademicYear',
        entityId: id,
        changes: diffChanges(before, y) as never,
      },
      tx,
    );
    return yearDto(y);
  });
}

export async function deleteYear(actor: ActorContext, id: string) {
  assertGlobal(actor, 'session:manage');
  const y = await prisma.academicYear.findUnique({ where: { id }, include: yearInclude });
  if (!y) throw new NotFoundError('Academic year');
  if (y._count.sessions > 0)
    throw hasDependents('Delete or move its sessions first', { sessions: y._count.sessions });
  await prisma.$transaction(async (tx) => {
    await tx.academicYear.delete({ where: { id } });
    await recordAudit(
      actor,
      {
        action: 'academic_year.deleted',
        entityType: 'AcademicYear',
        entityId: id,
        changes: { label: y.label },
      },
      tx,
    );
  });
}

// ----- sessions --------------------------------------------------------------

const sessionInclude = {
  academicYear: { select: { id: true, label: true } },
  gradingScale: { select: { id: true, name: true } },
  policy: true,
  registrationPeriod: {
    include: {
      priorityWindows: {
        orderBy: { opensAt: 'asc' as const },
        include: { program: { select: { id: true, code: true, name: true } } },
      },
    },
  },
} as const;
type SessionRow = Prisma.AcademicSessionGetPayload<{ include: typeof sessionInclude }>;

export type RegistrationState =
  'NOT_CONFIGURED' | 'UPCOMING' | 'OPEN' | 'LATE' | 'ADD_DROP' | 'CLOSED';

/** Registration phase at `now` (priority windows are per-student and handled by the registration engine). */
export function registrationState(
  period: SessionRow['registrationPeriod'],
  now = new Date(),
): RegistrationState {
  if (!period) return 'NOT_CONFIGURED';
  if (now < period.opensAt) return 'UPCOMING';
  if (now < period.closesAt) return 'OPEN';
  if (period.lateClosesAt && now < period.lateClosesAt) return 'LATE';
  if (now <= period.addDropDeadline) return 'ADD_DROP';
  return 'CLOSED';
}

function policyDto(p: NonNullable<SessionRow['policy']>) {
  return {
    minCredits: num(p.minCredits)!,
    maxCredits: num(p.maxCredits)!,
    maxCreditsWithOverride: num(p.maxCreditsWithOverride),
    approvalMode: p.approvalMode,
    waitlistEnabled: p.waitlistEnabled,
    waitlistMaxPerSection: p.waitlistMaxPerSection,
    promotionMode: p.promotionMode,
    offerWindowHours: p.offerWindowHours,
    countWaitlistInCredits: p.countWaitlistInCredits,
    allowInProgressPrereqs: p.allowInProgressPrereqs,
    withdrawalRequiresApproval: p.withdrawalRequiresApproval,
    updatedAt: p.updatedAt.toISOString(),
  };
}

function periodDto(p: NonNullable<SessionRow['registrationPeriod']>) {
  return {
    id: p.id,
    opensAt: p.opensAt.toISOString(),
    closesAt: p.closesAt.toISOString(),
    lateClosesAt: p.lateClosesAt?.toISOString() ?? null,
    addDropDeadline: p.addDropDeadline.toISOString(),
    withdrawalDeadline: p.withdrawalDeadline.toISOString(),
    priorityWindows: p.priorityWindows.map((w) => ({
      id: w.id,
      name: w.name,
      opensAt: w.opensAt.toISOString(),
      program: w.program,
      yearOfStudy: w.yearOfStudy,
      cohort: w.cohort,
    })),
  };
}

function sessionDto(s: SessionRow) {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    type: s.type,
    status: s.status,
    isCurrent: s.isCurrent,
    startDate: isoDate(s.startDate),
    endDate: isoDate(s.endDate),
    academicYear: s.academicYear,
    gradingScale: s.gradingScale,
    policy: s.policy ? policyDto(s.policy) : null,
    registrationPeriod: s.registrationPeriod ? periodDto(s.registrationPeriod) : null,
    registrationState: registrationState(s.registrationPeriod),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export async function listSessions(q: {
  academicYearId?: string;
  status?: string;
  current?: boolean;
}) {
  const rows = await prisma.academicSession.findMany({
    where: {
      ...(q.academicYearId ? { academicYearId: q.academicYearId } : {}),
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.current !== undefined ? { isCurrent: q.current } : {}),
    },
    orderBy: { startDate: 'desc' },
    include: sessionInclude,
  });
  return rows.map(sessionDto);
}

export async function getSession(id: string) {
  const s = await prisma.academicSession.findUnique({ where: { id }, include: sessionInclude });
  if (!s) throw new NotFoundError('Academic session');
  return sessionDto(s);
}

async function assertWithinYear(yearId: string, start: Date, end: Date) {
  const year = await prisma.academicYear.findUnique({ where: { id: yearId } });
  if (!year) throw invalidField('academicYearId', 'Unknown academic year');
  if (start < year.startDate || end > year.endDate) {
    throw invalidField(
      'startDate',
      `Session dates must fall within ${year.label} (${isoDate(year.startDate)} – ${isoDate(year.endDate)})`,
    );
  }
}

async function assertGradingScale(id: string | null | undefined) {
  if (id && !(await prisma.gradingScale.findUnique({ where: { id } })))
    throw invalidField('gradingScaleId', 'Unknown grading scale');
}

export async function createSession(
  actor: ActorContext,
  input: z.output<typeof academicSessionCreateSchema>,
) {
  assertGlobal(actor, 'session:manage');
  const start = day(input.startDate);
  const end = day(input.endDate);
  await assertWithinYear(input.academicYearId, start, end);
  await assertGradingScale(input.gradingScaleId);
  if (await prisma.academicSession.findUnique({ where: { code: input.code } })) {
    throw new ConflictError(ErrorCode.UNIQUE_VIOLATION, 'A session with this code already exists', {
      fields: [{ path: 'body.code', message: 'Already in use' }],
    });
  }
  return prisma.$transaction(async (tx) => {
    const s = await tx.academicSession.create({
      data: { ...input, startDate: start, endDate: end },
      include: sessionInclude,
    });
    await recordAudit(
      actor,
      {
        action: 'session.created',
        entityType: 'AcademicSession',
        entityId: s.id,
        changes: input as never,
      },
      tx,
    );
    return sessionDto(s);
  });
}

export async function updateSession(
  actor: ActorContext,
  id: string,
  input: z.output<typeof academicSessionUpdateSchema>,
) {
  assertGlobal(actor, 'session:manage');
  const before = await prisma.academicSession.findUnique({ where: { id } });
  if (!before) throw new NotFoundError('Academic session');
  if (before.status === 'ARCHIVED') {
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      'Archived sessions cannot be edited',
    );
  }
  const start = input.startDate ? day(input.startDate) : before.startDate;
  const end = input.endDate ? day(input.endDate) : before.endDate;
  if (start >= end) throw invalidField('endDate', 'End date must be after the start date');
  await assertWithinYear(before.academicYearId, start, end);
  await assertGradingScale(input.gradingScaleId);
  if (
    input.code &&
    input.code !== before.code &&
    (await prisma.academicSession.findUnique({ where: { code: input.code } }))
  ) {
    throw new ConflictError(ErrorCode.UNIQUE_VIOLATION, 'A session with this code already exists', {
      fields: [{ path: 'body.code', message: 'Already in use' }],
    });
  }
  return prisma.$transaction(async (tx) => {
    const s = await tx.academicSession.update({
      where: { id },
      data: { ...input, startDate: start, endDate: end },
      include: sessionInclude,
    });
    // Date changes on an active session are audited distinctly (BR-020).
    const action =
      before.status === 'ACTIVE' && (input.startDate || input.endDate)
        ? 'session.active_dates_changed'
        : 'session.updated';
    await recordAudit(
      actor,
      {
        action,
        entityType: 'AcademicSession',
        entityId: id,
        changes: diffChanges(before, s) as never,
      },
      tx,
    );
    return sessionDto(s);
  });
}

const TRANSITIONS: Record<string, { from: string[]; to?: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED' }> = {
  activate: { from: ['PLANNED'], to: 'ACTIVE' },
  complete: { from: ['ACTIVE'], to: 'COMPLETED' },
  archive: { from: ['COMPLETED'], to: 'ARCHIVED' },
  'make-current': { from: ['PLANNED', 'ACTIVE'] },
};

export async function transitionSession(
  actor: ActorContext,
  id: string,
  action: keyof typeof TRANSITIONS,
) {
  assertGlobal(actor, 'session:manage');
  const s = await prisma.academicSession.findUnique({ where: { id } });
  if (!s) throw new NotFoundError('Academic session');
  const rule = TRANSITIONS[action]!;
  if (!rule.from.includes(s.status)) {
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      `Cannot ${action.replace('-', ' ')} a ${s.status.toLowerCase()} session`,
      {
        status: s.status,
        allowedFrom: rule.from,
      },
    );
  }
  const updated = await prisma.$transaction(async (tx) => {
    if (action === 'make-current') {
      await tx.academicSession.updateMany({
        where: { type: s.type, isCurrent: true },
        data: { isCurrent: false },
      });
      await tx.academicSession.update({ where: { id }, data: { isCurrent: true } });
    } else {
      await tx.academicSession.update({
        where: { id },
        // A completed session can no longer be the current one.
        data: { status: rule.to, ...(rule.to !== 'ACTIVE' ? { isCurrent: false } : {}) },
      });
    }
    await recordAudit(
      actor,
      {
        action: `session.${action.replace('-', '_')}`,
        entityType: 'AcademicSession',
        entityId: id,
        changes: { from: s.status, to: rule.to ?? s.status },
      },
      tx,
    );
    return tx.academicSession.findUniqueOrThrow({ where: { id }, include: sessionInclude });
  });
  return sessionDto(updated);
}

export async function deleteSession(actor: ActorContext, id: string) {
  assertGlobal(actor, 'session:manage');
  const s = await prisma.academicSession.findUnique({ where: { id } });
  if (!s) throw new NotFoundError('Academic session');
  if (s.status !== 'PLANNED') {
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      'Only planned sessions can be deleted',
    );
  }
  await prisma.$transaction(async (tx) => {
    await tx.academicSession.delete({ where: { id } });
    await recordAudit(
      actor,
      {
        action: 'session.deleted',
        entityType: 'AcademicSession',
        entityId: id,
        changes: { code: s.code },
      },
      tx,
    );
  });
}

// ----- policy, registration period, priority windows -------------------------

async function editableSession(id: string) {
  const s = await prisma.academicSession.findUnique({ where: { id } });
  if (!s) throw new NotFoundError('Academic session');
  if (s.status === 'COMPLETED' || s.status === 'ARCHIVED') {
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      'Registration settings of a finished session cannot change',
    );
  }
  return s;
}

export async function upsertPolicy(
  actor: ActorContext,
  sessionId: string,
  input: z.output<typeof sessionPolicySchema>,
) {
  assertGlobal(actor, 'registration_period:manage');
  await editableSession(sessionId);
  const before = await prisma.sessionPolicy.findUnique({ where: { sessionId } });
  const policy = await prisma.$transaction(async (tx) => {
    const p = await tx.sessionPolicy.upsert({
      where: { sessionId },
      create: { ...input, sessionId },
      update: input,
    });
    await recordAudit(
      actor,
      {
        action: 'session.policy_saved',
        entityType: 'AcademicSession',
        entityId: sessionId,
        changes: diffChanges(before ?? {}, p) as never,
      },
      tx,
    );
    return p;
  });
  return policyDto(policy);
}

export async function upsertPeriod(
  actor: ActorContext,
  sessionId: string,
  input: z.output<typeof registrationPeriodSchema>,
) {
  assertGlobal(actor, 'registration_period:manage');
  const session = await editableSession(sessionId);
  const data = {
    opensAt: new Date(input.opensAt),
    closesAt: new Date(input.closesAt),
    lateClosesAt: input.lateClosesAt ? new Date(input.lateClosesAt) : null,
    addDropDeadline: new Date(input.addDropDeadline),
    withdrawalDeadline: new Date(input.withdrawalDeadline),
  };
  // Withdrawal must end by the last day of the session.
  const sessionEnd = new Date(session.endDate.getTime() + 24 * 3600 * 1000);
  if (data.withdrawalDeadline > sessionEnd)
    throw invalidField('withdrawalDeadline', 'Must be on or before the session end date');
  const latestWindow = await prisma.priorityWindow.findFirst({
    where: { period: { sessionId } },
    orderBy: { opensAt: 'desc' },
  });
  if (latestWindow && latestWindow.opensAt >= data.opensAt) {
    throw invalidField(
      'opensAt',
      'Priority windows must open before general registration; adjust them first',
    );
  }
  const before = await prisma.registrationPeriod.findUnique({ where: { sessionId } });
  await prisma.$transaction(async (tx) => {
    const p = await tx.registrationPeriod.upsert({
      where: { sessionId },
      create: { ...data, sessionId },
      update: data,
    });
    await recordAudit(
      actor,
      {
        action: 'session.registration_period_saved',
        entityType: 'AcademicSession',
        entityId: sessionId,
        changes: diffChanges(before ?? {}, p) as never,
      },
      tx,
    );
  });
  return getSession(sessionId);
}

export async function addPriorityWindow(
  actor: ActorContext,
  sessionId: string,
  input: z.output<typeof priorityWindowSchema>,
) {
  assertGlobal(actor, 'registration_period:manage');
  await editableSession(sessionId);
  const period = await prisma.registrationPeriod.findUnique({ where: { sessionId } });
  if (!period)
    throw new BusinessRuleError(
      ErrorCode.VALIDATION_ERROR,
      'Configure the registration period first',
    );
  const opensAt = new Date(input.opensAt);
  if (opensAt >= period.opensAt)
    throw invalidField('opensAt', 'Must be before general registration opens');
  if (input.programId && !(await prisma.program.findUnique({ where: { id: input.programId } }))) {
    throw invalidField('programId', 'Unknown program');
  }
  await prisma.$transaction(async (tx) => {
    const w = await tx.priorityWindow.create({ data: { ...input, opensAt, periodId: period.id } });
    await recordAudit(
      actor,
      {
        action: 'session.priority_window_added',
        entityType: 'AcademicSession',
        entityId: sessionId,
        changes: { windowId: w.id, ...input } as never,
      },
      tx,
    );
  });
  return getSession(sessionId);
}

export async function removePriorityWindow(
  actor: ActorContext,
  sessionId: string,
  windowId: string,
) {
  assertGlobal(actor, 'registration_period:manage');
  await editableSession(sessionId);
  const w = await prisma.priorityWindow.findFirst({
    where: { id: windowId, period: { sessionId } },
  });
  if (!w) throw new NotFoundError('Priority window');
  await prisma.$transaction(async (tx) => {
    await tx.priorityWindow.delete({ where: { id: windowId } });
    await recordAudit(
      actor,
      {
        action: 'session.priority_window_removed',
        entityType: 'AcademicSession',
        entityId: sessionId,
        changes: { windowId, name: w.name },
      },
      tx,
    );
  });
  return getSession(sessionId);
}
