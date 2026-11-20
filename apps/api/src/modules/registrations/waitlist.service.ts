import { ErrorCode } from '@ucrams/shared';

import type { ActorContext } from '../../common/context/actor.js';
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
} from '../../common/exceptions/app-error.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import { covers } from '../authz/authz.js';
import {
  queueNotifications,
  type NewNotification,
} from '../notifications/notifications.service.js';
import {
  adjustCounters,
  endRegistration,
  enqueuePromotion,
  lockSection,
  overrideSet,
  recordEvent,
  ruleError,
  scheduleOfferExpiry,
  studentNotice,
  type Tx,
} from './registration-core.js';
import { loadContext } from './registration-context.js';
import { evaluate } from './rules.js';

/** Thrown inside the promotion transaction when a candidate's row is busy. */
class StudentBusy extends Error {}

/**
 * Promotes waitlisted students while seats are free (FR-REG-022/023). Each
 * candidate is re-validated; ineligible ones leave the waitlist and are told why.
 * The section lock is taken first here, so the candidate's student lock uses
 * NOWAIT to avoid deadlocking with a registration holding student → section.
 */
export async function promoteSection(sectionId: string, now = new Date()) {
  let promoted = 0;
  let skipped = 0;
  for (let guard = 0; guard < 500; guard++) {
    let notices: () => void = () => undefined;
    let outcome: 'done' | 'promoted' | 'skipped' | 'busy';
    try {
      outcome = await prisma.$transaction(async (tx) => {
        await lockSection(tx, sectionId);
        const section = await tx.courseSection.findUniqueOrThrow({
          where: { id: sectionId },
          include: { course: { select: { code: true } }, session: { include: { policy: true } } },
        });
        if (section.status !== 'PUBLISHED' || section.enrolledCount >= section.capacity)
          return 'done';
        const next = await tx.courseRegistration.findFirst({
          where: { sectionId, status: 'WAITLISTED' },
          orderBy: [{ waitlistedAt: 'asc' }, { id: 'asc' }],
          include: { student: { select: { userId: true } } },
        });
        if (!next) return 'done';
        try {
          await tx.$queryRaw`SELECT id FROM students WHERE id = ${next.studentId}::uuid FOR UPDATE NOWAIT`;
        } catch {
          throw new StudentBusy();
        }
        const ctx = await loadContext(tx, next.studentId, sectionId, {
          now,
          excludeRegistrationId: next.id,
        });
        const ev = evaluate(ctx, overrideSet(next.overrides));
        const sec = `${section.course.code} ${section.sectionCode}`;
        if (ev.blocking) {
          // The registration window has closed: entries expire with the period instead.
          if (ev.blocking.code === ErrorCode.REGISTRATION_PERIOD_CLOSED) return 'done';
          await endRegistration(
            tx,
            next,
            'CANCELLED',
            'PROMOTION_SKIPPED',
            null,
            ev.blocking.message,
            { rule: ev.blocking.code },
          );
          notices = await queueNotifications(tx, [
            studentNotice(
              next.student.userId,
              `Removed from the ${sec} waitlist`,
              `A seat opened but you are no longer eligible: ${ev.blocking.message}.`,
              'WAITLIST',
            ),
          ]);
          return 'skipped';
        }
        const offer = section.session.policy?.promotionMode === 'OFFER';
        const status = offer ? 'OFFERED' : ev.needsApproval ? 'PENDING' : 'REGISTERED';
        const expires = offer
          ? new Date(now.getTime() + (section.session.policy?.offerWindowHours ?? 24) * 3600_000)
          : null;
        await tx.courseRegistration.update({
          where: { id: next.id },
          data: {
            status,
            offerExpiresAt: expires,
            registeredAt: status === 'REGISTERED' ? now : null,
          },
        });
        await adjustCounters(tx, sectionId, { enrolled: 1, waitlist: -1 });
        await recordEvent(tx, {
          registrationId: next.id,
          from: 'WAITLISTED',
          to: status,
          action: offer ? 'OFFERED' : 'PROMOTED',
          details: expires ? { offerExpiresAt: expires.toISOString() } : undefined,
        });
        const notice: NewNotification = offer
          ? studentNotice(
              next.student.userId,
              `A seat in ${sec} is yours to claim`,
              `Claim it before ${expires!.toISOString()} or it passes to the next student.`,
              'WAITLIST',
            )
          : studentNotice(
              next.student.userId,
              status === 'PENDING'
                ? `${sec}: seat held, awaiting approval`
                : `You are now registered in ${sec}`,
              'You moved off the waitlist.',
              'WAITLIST',
            );
        notices = await queueNotifications(tx, [notice]);
        if (expires) await scheduleOfferExpiry(next.id, expires);
        return 'promoted';
      });
    } catch (err) {
      if (err instanceof StudentBusy) outcome = 'busy';
      else throw err;
    }
    notices();
    if (outcome === 'done') break;
    if (outcome === 'busy') {
      // Retry shortly instead of waiting on the student's lock.
      await enqueuePromotion(sectionId, 2000);
      break;
    }
    if (outcome === 'promoted') promoted++;
    else skipped++;
  }
  return { promoted, skipped };
}

/** Claim an offered seat (OFFER mode): the seat is already held, so only the student's other rules are re-checked. */
export async function claimOffer(actor: ActorContext, id: string) {
  const reg = await prisma.courseRegistration.findUnique({
    where: { id },
    include: {
      student: { select: { userId: true } },
      course: { select: { code: true } },
      section: { select: { sectionCode: true } },
    },
  });
  if (!reg || reg.student.userId !== actor.userId) throw new NotFoundError('Registration');
  if (reg.status !== 'OFFERED')
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      'There is no open offer to claim',
    );
  if (reg.offerExpiresAt && reg.offerExpiresAt < new Date())
    throw new BusinessRuleError(ErrorCode.INVALID_STATE_TRANSITION, 'This offer has expired');
  let after: () => void = () => undefined;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM students WHERE id = ${reg.studentId}::uuid FOR UPDATE`;
    await lockSection(tx, reg.sectionId);
    const ctx = await loadContext(tx, reg.studentId, reg.sectionId, { excludeRegistrationId: id });
    // The offered seat is counted in enrolledCount already; capacity is not re-checked.
    const ev = evaluate(ctx, overrideSet([...reg.overrides, 'CAPACITY']));
    if (ev.blocking && ev.blocking.code !== ErrorCode.REGISTRATION_PERIOD_CLOSED)
      throw ruleError(ev.blocking);
    const status = ev.needsApproval ? 'PENDING' : 'REGISTERED';
    await tx.courseRegistration.update({
      where: { id },
      data: {
        status,
        offerExpiresAt: null,
        registeredAt: status === 'REGISTERED' ? new Date() : null,
      },
    });
    await recordEvent(tx, {
      registrationId: id,
      from: 'OFFERED',
      to: status,
      action: 'OFFER_CLAIMED',
      actorId: actor.userId,
    });
    after = await queueNotifications(tx, [
      studentNotice(
        reg.student.userId,
        `Seat in ${reg.course.code} ${reg.section.sectionCode} claimed`,
        status === 'PENDING' ? 'It now awaits approval.' : 'You are registered.',
      ),
    ]);
  });
  after();
  return {
    id,
    status: (await prisma.courseRegistration.findUniqueOrThrow({ where: { id } })).status,
  };
}

/** Expires an unclaimed offer and passes the seat on (FR-REG-023). */
export async function expireOffer(registrationId: string, now = new Date()) {
  let freed: string | null = null;
  let after: () => void = () => undefined;
  await prisma.$transaction(async (tx) => {
    const reg = await tx.courseRegistration.findUnique({
      where: { id: registrationId },
      include: {
        student: { select: { userId: true } },
        course: { select: { code: true } },
        section: { select: { sectionCode: true } },
      },
    });
    if (!reg || reg.status !== 'OFFERED' || !reg.offerExpiresAt || reg.offerExpiresAt > now) return;
    await lockSection(tx, reg.sectionId);
    await endRegistration(
      tx,
      reg,
      'EXPIRED',
      'OFFER_EXPIRED',
      null,
      'The offer was not claimed in time',
    );
    freed = reg.sectionId;
    after = await queueNotifications(tx, [
      studentNotice(
        reg.student.userId,
        `Offer for ${reg.course.code} ${reg.section.sectionCode} expired`,
        'The seat has passed to the next student on the waitlist.',
        'WAITLIST',
      ),
    ]);
  });
  after();
  if (freed) await promoteSection(freed, now);
}

/** All waitlist entries expire when the registration period closes (FR-REG-024). */
export async function expireClosedWaitlists(now = new Date()) {
  const entries = await prisma.courseRegistration.findMany({
    where: {
      status: 'WAITLISTED',
      session: {
        registrationPeriod: {
          OR: [{ lateClosesAt: { lt: now } }, { lateClosesAt: null, closesAt: { lt: now } }],
        },
      },
    },
    include: {
      student: { select: { userId: true } },
      course: { select: { code: true } },
      section: { select: { sectionCode: true } },
    },
  });
  for (const e of entries) {
    let after: () => void = () => undefined;
    await prisma.$transaction(async (tx) => {
      await lockSection(tx, e.sectionId);
      const current = await tx.courseRegistration.findUniqueOrThrow({ where: { id: e.id } });
      if (current.status !== 'WAITLISTED') return;
      await endRegistration(
        tx,
        current,
        'EXPIRED',
        'EXPIRED',
        null,
        'The registration period closed',
      );
      after = await queueNotifications(tx, [
        studentNotice(
          e.student.userId,
          `Waitlist for ${e.course.code} ${e.section.sectionCode} closed`,
          'Registration has closed, so the waitlist has ended.',
          'WAITLIST',
        ),
      ]);
    });
    after();
  }
  return entries.length;
}

/** Repeatable safety net (ARCHITECTURE.md §8): promotions and offer expiries that were missed. */
export async function sweepWaitlists(now = new Date()) {
  const stale = await prisma.courseRegistration.findMany({
    where: { status: 'OFFERED', offerExpiresAt: { lt: now } },
    select: { id: true },
  });
  for (const o of stale) await expireOffer(o.id, now);
  const sections = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM course_sections
     WHERE status = 'PUBLISHED' AND enrolled_count < capacity AND waitlist_count > 0`;
  for (const s of sections) await enqueuePromotion(s.id);
  const expired = await expireClosedWaitlists(now);
  return { expiredOffers: stale.length, sectionsQueued: sections.length, expiredWaitlist: expired };
}

/** Recomputes section counters from registrations; drift should never happen (DATABASE.md §6). */
/** `expected` suppresses the drift alarm when the caller wrote rows without counters (seeding). */
export async function reconcileCounters(options: { expected?: boolean } = {}) {
  const drift = await prisma.$queryRaw<Array<{ id: string; enrolled: number; waitlisted: number }>>`
    SELECT s.id, COALESCE(c.enrolled, 0)::int AS enrolled, COALESCE(c.waitlisted, 0)::int AS waitlisted
      FROM course_sections s
      LEFT JOIN (
        SELECT section_id,
               COUNT(*) FILTER (WHERE status IN ('PENDING','REGISTERED','OFFERED')) AS enrolled,
               COUNT(*) FILTER (WHERE status = 'WAITLISTED') AS waitlisted
          FROM course_registrations GROUP BY section_id
      ) c ON c.section_id = s.id
     WHERE s.enrolled_count <> COALESCE(c.enrolled, 0) OR s.waitlist_count <> COALESCE(c.waitlisted, 0)`;
  for (const d of drift) {
    await prisma.$transaction(async (tx) => {
      await lockSection(tx, d.id);
      await tx.$executeRaw`
        UPDATE course_sections SET enrolled_count = ${d.enrolled}, waitlist_count = ${d.waitlisted},
               capacity = GREATEST(capacity, ${d.enrolled})
         WHERE id = ${d.id}::uuid`;
    });
  }
  if (drift.length && !options.expected)
    logger.error(
      { sections: drift.map((d) => d.id) },
      'Registration counters drifted and were reconciled',
    );
  return { fixed: drift.length };
}

/**
 * Section cancellation cascade (FR-CRS-010, BR-009): every active registration
 * and waitlist entry is cancelled and students and instructors are notified.
 * Runs inside the cancelling transaction.
 */
export async function cancelSectionRegistrations(
  tx: Tx,
  section: { id: string; sectionCode: string; course: { code: string } },
  actorId: string,
  reason: string | null,
): Promise<() => void> {
  const active = await tx.courseRegistration.findMany({
    where: {
      sectionId: section.id,
      status: { in: ['PENDING', 'REGISTERED', 'OFFERED', 'WAITLISTED'] },
    },
    include: { student: { select: { userId: true } } },
  });
  if (active.length) {
    await tx.courseRegistration.updateMany({
      where: { id: { in: active.map((a) => a.id) } },
      data: { status: 'CANCELLED', endedAt: new Date(), offerExpiresAt: null },
    });
    await tx.registrationEvent.createMany({
      data: active.map((a) => ({
        registrationId: a.id,
        fromStatus: a.status,
        toStatus: 'CANCELLED' as const,
        action: 'SECTION_CANCELLED',
        actorId,
        reason,
      })),
    });
  }
  await tx.$executeRaw`UPDATE course_sections SET enrolled_count = 0, waitlist_count = 0 WHERE id = ${section.id}::uuid`;
  const instructors = await tx.sectionInstructor.findMany({
    where: { sectionId: section.id },
    select: { facultyMember: { select: { userId: true } } },
  });
  const sec = `${section.course.code} ${section.sectionCode}`;
  return queueNotifications(tx, [
    ...active.map((a) =>
      studentNotice(
        a.student.userId,
        `${sec} has been cancelled`,
        `Your ${a.status === 'WAITLISTED' ? 'waitlist place' : 'registration'} was cancelled${reason ? `: ${reason}` : '.'} No transcript entry is created.`,
      ),
    ),
    ...instructors.map((i) => ({
      userId: i.facultyMember.userId,
      category: 'SCHEDULE' as const,
      title: `${sec} has been cancelled`,
      body: reason ?? 'The section will not run this session.',
      link: `/faculty/dashboard`,
    })),
  ]);
}

/** Administrator: run promotion now for a section (FR-ADMIN-023). */
export async function promoteNow(actor: ActorContext, sectionId: string) {
  const s = await prisma.courseSection.findUnique({
    where: { id: sectionId },
    select: {
      course: { select: { departmentId: true, department: { select: { schoolId: true } } } },
    },
  });
  if (!s) throw new NotFoundError('Section');
  if (
    !covers(actor.grants, 'waitlist:manage', {
      departmentId: s.course.departmentId,
      schoolId: s.course.department.schoolId,
    })
  )
    throw new ForbiddenError();
  const result = await promoteSection(sectionId);
  await recordAudit(actor, {
    action: 'waitlist.promoted_manually',
    entityType: 'CourseSection',
    entityId: sectionId,
    changes: result,
  });
  return result;
}
