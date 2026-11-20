import { ErrorCode, type OverridableRule } from '@ucrams/shared';
import { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext } from '../../common/context/actor.js';
import type { AppError } from '../../common/exceptions/app-error.js';
import { BusinessRuleError, ConflictError } from '../../common/exceptions/app-error.js';
import { invalidateDashboards } from '../analytics/dashboard.service.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { getQueue, QueueName } from '../../infrastructure/queues/queues.js';
import { logger } from '../../config/logger.js';
import type { NewNotification } from '../notifications/notifications.service.js';
import type { RuleResult } from './rules.js';

export type Tx = Prisma.TransactionClient;
type Status = Prisma.CourseRegistrationCreateInput['status'];

export const SEAT_HOLDING: Status[] = ['PENDING', 'REGISTERED', 'OFFERED'];
export const isSeat = (s: string) => (SEAT_HOLDING as string[]).includes(s);

const CONFLICT_CODES = new Set<string>([
  ErrorCode.DUPLICATE_REGISTRATION,
  ErrorCode.SECTION_FULL,
  ErrorCode.WAITLIST_FULL,
]);

/** Rule failure → API error (409 for seat/duplicate conflicts, 422 otherwise; API.md §6). */
export function ruleError(r: RuleResult, extra: Record<string, unknown> = {}): AppError {
  const details = {
    ...(r.details ?? {}),
    ...(r.override ? { overridable: r.override } : {}),
    ...extra,
  };
  return CONFLICT_CODES.has(r.code)
    ? new ConflictError(r.code, r.message, details)
    : new BusinessRuleError(r.code, r.message, details);
}

/** Student row lock: serialises one student's registrations (taken before section locks). */
export async function lockStudent(tx: Tx, studentId: string) {
  await tx.$queryRaw`SELECT id FROM students WHERE id = ${studentId}::uuid FOR UPDATE`;
}

/** Section row lock; callers lock several sections in ascending id order. */
export async function lockSection(tx: Tx, sectionId: string) {
  await tx.$queryRaw`SELECT id FROM course_sections WHERE id = ${sectionId}::uuid FOR UPDATE`;
}

/** Retries a transaction on deadlock/serialization failure (max 3 attempts, jittered). */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryable =
        (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') ||
        /deadlock detected|could not serialize/i.test(String((err as Error)?.message));
      if (!retryable || attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 20 * attempt + Math.random() * 30));
    }
  }
}

export async function adjustCounters(
  tx: Tx,
  sectionId: string,
  delta: { enrolled?: number; waitlist?: number },
) {
  const e = delta.enrolled ?? 0;
  const w = delta.waitlist ?? 0;
  if (!e && !w) return;
  await tx.$executeRaw`
    UPDATE course_sections
       SET enrolled_count = enrolled_count + ${e}, waitlist_count = waitlist_count + ${w}, updated_at = now()
     WHERE id = ${sectionId}::uuid`;
}

/** Appends a history entry (FR-REG-020). */
export async function recordEvent(
  tx: Tx,
  e: {
    registrationId: string;
    from: Status | null;
    to: Status;
    action: string;
    actorId?: string | null;
    reason?: string | null;
    details?: Record<string, unknown>;
  },
) {
  await tx.registrationEvent.create({
    data: {
      registrationId: e.registrationId,
      fromStatus: e.from,
      toStatus: e.to,
      action: e.action,
      actorId: e.actorId ?? null,
      reason: e.reason ?? null,
      details: (e.details ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
  // Every registration change goes through here; dashboards recompute on their next read.
  invalidateDashboards();
}

/**
 * Moves a registration to an ending status, releasing its seat or waitlist
 * place. Returns whether a seat was freed (waitlist promotion should follow).
 */
export async function endRegistration(
  tx: Tx,
  reg: { id: string; sectionId: string; status: Status },
  to: Status,
  action: string,
  actorId: string | null,
  reason: string | null,
  details?: Record<string, unknown>,
): Promise<boolean> {
  await tx.courseRegistration.update({
    where: { id: reg.id },
    data: { status: to, endedAt: new Date(), offerExpiresAt: null },
  });
  const freedSeat = isSeat(reg.status);
  await adjustCounters(
    tx,
    reg.sectionId,
    freedSeat ? { enrolled: -1 } : reg.status === 'WAITLISTED' ? { waitlist: -1 } : {},
  );
  await recordEvent(tx, {
    registrationId: reg.id,
    from: reg.status,
    to,
    action,
    actorId,
    reason,
    details,
  });
  return freedSeat;
}

/** Collapses concurrent triggers into one job per section (ARCHITECTURE.md §8). */
export async function enqueuePromotion(sectionId: string, delayMs = 0) {
  try {
    await getQueue(QueueName.WAITLIST).add(
      'promote',
      { sectionId },
      { jobId: `promote-${sectionId}`, delay: delayMs, removeOnComplete: true, removeOnFail: 100 },
    );
  } catch (err) {
    // The sweeper picks up anything missed here.
    logger.warn({ err, sectionId }, 'Failed to enqueue waitlist promotion');
  }
}

export async function scheduleOfferExpiry(registrationId: string, at: Date) {
  try {
    await getQueue(QueueName.WAITLIST).add(
      'expire-offer',
      { registrationId },
      {
        jobId: `offer-${registrationId}`,
        delay: Math.max(0, at.getTime() - Date.now()),
        removeOnComplete: true,
      },
    );
  } catch (err) {
    logger.warn({ err, registrationId }, 'Failed to schedule offer expiry');
  }
}

export function overrideSet(list: readonly string[]): Set<OverridableRule> {
  return new Set(list as OverridableRule[]);
}

/** Section label used in notifications. */
export const label = (s: { course: { code: string }; sectionCode: string }) =>
  `${s.course.code} ${s.sectionCode}`;

export function studentNotice(
  userId: string,
  title: string,
  body: string,
  category: NewNotification['category'] = 'REGISTRATION',
): NewNotification {
  return { userId, category, title, body, link: '/student/registrations' };
}

export type { ActorContext };
export { prisma };

/**
 * Transaction options for lock-holding work: callers may queue behind a busy
 * section, so the wait for a connection and the transaction budget are generous.
 */
export const LOCKING_TX = { maxWait: 15_000, timeout: 20_000 } as const;
