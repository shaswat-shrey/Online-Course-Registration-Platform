import {
  ErrorCode,
  type announcementCreateSchema,
  type announcementUpdateSchema,
} from '@ucrams/shared';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext } from '../../common/context/actor.js';
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
} from '../../common/exceptions/app-error.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { getQueue, QueueName } from '../../infrastructure/queues/queues.js';
import { recordAudit } from '../audit/audit.service.js';
import { hasGlobal, hasPermission } from '../authz/authz.js';
import { loadPeople, portalOf } from '../messaging/people.js';
import {
  queueNotifications,
  type NewNotification,
} from '../notifications/notifications.service.js';
import { canInSection, isSectionStudent, sectionAccess } from '../teaching/teaching-access.js';
import {
  assertCanTarget,
  audienceLabels,
  audienceMatch,
  loadViewer,
  resolveRecipients,
  type Audience,
} from './audience.js';

const include = {
  author: { select: { firstName: true, lastName: true } },
  audiences: true,
  _count: { select: { reads: true } },
} satisfies Prisma.AnnouncementInclude;
type Row = Prisma.AnnouncementGetPayload<{ include: typeof include }>;

const asAudience = (a: Row['audiences'][number]): Audience => ({
  type: a.targetType,
  targetId: a.targetId,
  targetValue: a.targetValue,
  roleFilter: a.roleFilter,
});

/** Global publishers moderate every announcement; everyone else manages their own. */
const canManage = (actor: ActorContext, a: { authorId: string }) =>
  a.authorId === actor.userId || hasGlobal(actor.grants, 'announcement:publish_global');

async function toDtos(rows: Row[], actor: ActorContext, readIds = new Set<string>()) {
  const label = await audienceLabels(rows.flatMap((r) => r.audiences.map(asAudience)));
  const now = Date.now();
  return rows.map((a) => {
    const audiences = a.audiences.map((x) => ({ ...asAudience(x), label: label(asAudience(x)) }));
    const manage = canManage(actor, a);
    return {
      id: a.id,
      title: a.title,
      body: a.body,
      priority: a.priority,
      pinned: a.pinned,
      publishedAt: a.publishedAt.toISOString(),
      expiresAt: a.expiresAt?.toISOString() ?? null,
      scheduled: a.publishedAt.getTime() > now,
      expired: !!a.expiresAt && a.expiresAt.getTime() <= now,
      author: `${a.author.firstName} ${a.author.lastName}`,
      mine: a.authorId === actor.userId,
      canManage: manage,
      read: readIds.has(a.id),
      readCount: manage ? a._count.reads : null,
      audiences,
      sections: audiences
        .filter((x) => x.type === 'SECTION')
        .map((x) => ({ id: x.targetId!, label: x.label })),
    };
  });
}
export type AnnouncementDto = Awaited<ReturnType<typeof toDtos>>[number];

/** Anyone holding one of the announcement permissions may compose; targeting is checked per audience. */
function assertPublisher(actor: ActorContext) {
  if (
    !hasPermission(actor.grants, 'announcement:publish_section') &&
    !hasPermission(actor.grants, 'announcement:publish_scoped') &&
    !hasPermission(actor.grants, 'announcement:publish_global')
  )
    throw new ForbiddenError();
}

// ----- scheduling and fan-out (FR-COMM-009/010) ---------------------------------------------

const jobId = (id: string, at: Date) => `announce-${id}-${at.getTime()}`;

async function scheduleFanOut(id: string, at: Date, previous?: Date) {
  try {
    const queue = getQueue(QueueName.ANNOUNCEMENTS);
    if (previous) await queue.remove(jobId(id, previous));
    await queue.add(
      'publish',
      { announcementId: id },
      { jobId: jobId(id, at), delay: Math.max(0, at.getTime() - Date.now()) },
    );
  } catch (err) {
    // The minute sweep publishes anything a lost job missed.
    logger.error({ err: (err as Error).message, id }, 'Failed to schedule announcement');
  }
}

/**
 * Notifies everyone the announcement reaches, once, after its publish time.
 * Urgent announcements are also emailed regardless of preferences.
 */
export async function fanOutAnnouncement(id: string) {
  const a = await prisma.announcement.findUnique({ where: { id }, include: { audiences: true } });
  if (!a || a.notifiedAt || a.publishedAt.getTime() > Date.now()) return { notified: 0 };
  const claimed = await prisma.announcement.updateMany({
    where: { id, notifiedAt: null },
    data: { notifiedAt: new Date() },
  });
  if (!claimed.count) return { notified: 0 };
  if (a.expiresAt && a.expiresAt.getTime() <= Date.now()) return { notified: 0 };
  const recipients = await resolveRecipients(a.audiences.map(asAudience));
  recipients.delete(a.authorId);
  const people = await loadPeople([...recipients]);
  const ids = [...recipients];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const notices: NewNotification[] = chunk.map((userId) => {
      const p = people.get(userId);
      return {
        userId,
        category: 'ANNOUNCEMENT',
        title: `${a.priority === 'URGENT' ? 'Urgent: ' : ''}${a.title}`.slice(0, 200),
        body: a.body.slice(0, 300),
        link: `/${p ? portalOf(p) : 'admin'}/announcements?a=${a.id}`,
      };
    });
    const after = await prisma.$transaction((tx) =>
      queueNotifications(tx, notices, { forceEmail: a.priority === 'URGENT' }),
    );
    after();
  }
  return { notified: ids.length };
}

/** Publishes anything whose time has come but whose job was lost (runs every minute). */
export async function sweepDueAnnouncements() {
  const due = await prisma.announcement.findMany({
    where: { notifiedAt: null, publishedAt: { lte: new Date() } },
    select: { id: true },
    take: 50,
  });
  let notified = 0;
  for (const a of due) notified += (await fanOutAnnouncement(a.id)).notified;
  return { announcements: due.length, notified };
}

// ----- authoring --------------------------------------------------------------------------------

export async function createAnnouncement(
  actor: ActorContext,
  input: z.output<typeof announcementCreateSchema>,
) {
  assertPublisher(actor);
  await assertCanTarget(actor, input.audiences);
  const publishedAt = input.publishAt ? new Date(input.publishAt) : new Date();
  const created = await prisma.$transaction(async (tx) => {
    const a = await tx.announcement.create({
      data: {
        authorId: actor.userId,
        title: input.title,
        body: input.body,
        priority: input.priority,
        pinned: input.pinned,
        publishedAt,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        audiences: {
          create: input.audiences.map((x) => ({
            targetType: x.type,
            targetId: x.targetId,
            targetValue: x.targetValue,
            roleFilter: x.roleFilter,
          })),
        },
      },
      include,
    });
    await recordAudit(
      actor,
      {
        action:
          a.publishedAt.getTime() > Date.now()
            ? 'announcement.scheduled'
            : 'announcement.published',
        entityType: 'Announcement',
        entityId: a.id,
        changes: { audiences: input.audiences, publishAt: publishedAt.toISOString() } as never,
      },
      tx,
    );
    return a;
  });
  await scheduleFanOut(created.id, publishedAt);
  return (await toDtos([created], actor))[0]!;
}

async function managed(actor: ActorContext, id: string) {
  const a = await prisma.announcement.findUnique({ where: { id } });
  if (!a || !canManage(actor, a)) throw new NotFoundError('Announcement');
  return a;
}

export async function updateAnnouncement(
  actor: ActorContext,
  id: string,
  input: z.output<typeof announcementUpdateSchema>,
) {
  const current = await managed(actor, id);
  const { publishAt, expiresAt, ...rest } = input;
  let publishedAt: Date | undefined;
  if (publishAt !== undefined) {
    if (current.notifiedAt)
      throw new BusinessRuleError(
        ErrorCode.INVALID_STATE_TRANSITION,
        'This announcement has already been published',
      );
    publishedAt = new Date(publishAt);
    if (publishedAt.getTime() < Date.now()) publishedAt = new Date();
  }
  const nextExpiry = expiresAt === undefined ? current.expiresAt : expiresAt && new Date(expiresAt);
  if (nextExpiry && nextExpiry <= (publishedAt ?? current.publishedAt))
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Expiry must be after publishing', {
      fields: [{ path: 'body.expiresAt', message: 'Expiry must be after the publish time' }],
    });
  const a = await prisma.announcement.update({
    where: { id },
    data: {
      ...rest,
      ...(publishedAt ? { publishedAt } : {}),
      ...(expiresAt !== undefined ? { expiresAt: nextExpiry } : {}),
    },
    include,
  });
  if (publishedAt) await scheduleFanOut(id, publishedAt, current.publishedAt);
  await recordAudit(actor, {
    action: 'announcement.updated',
    entityType: 'Announcement',
    entityId: id,
    changes: input as never,
  });
  return (await toDtos([a], actor))[0]!;
}

export async function deleteAnnouncement(actor: ActorContext, id: string) {
  const a = await managed(actor, id);
  await prisma.announcement.delete({ where: { id } });
  if (!a.notifiedAt)
    await getQueue(QueueName.ANNOUNCEMENTS)
      .remove(jobId(id, a.publishedAt))
      .catch(() => undefined);
  await recordAudit(actor, {
    action: 'announcement.deleted',
    entityType: 'Announcement',
    entityId: id,
  });
}

/** Announcements you wrote (global publishers also see everyone's), newest first. */
export async function manageList(actor: ActorContext, q: { page: number; limit: number }) {
  assertPublisher(actor);
  const where: Prisma.AnnouncementWhereInput = hasGlobal(
    actor.grants,
    'announcement:publish_global',
  )
    ? {}
    : { authorId: actor.userId };
  const [total, rows] = await Promise.all([
    prisma.announcement.count({ where }),
    prisma.announcement.findMany({
      where,
      include,
      orderBy: { publishedAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
  ]);
  return { total, items: await toDtos(rows, actor) };
}

export async function myAnnouncements(actor: ActorContext) {
  const rows = await prisma.announcement.findMany({
    where: { authorId: actor.userId },
    include,
    orderBy: { publishedAt: 'desc' },
    take: 100,
  });
  return toDtos(rows, actor);
}

// ----- reading ------------------------------------------------------------------------------------

const live = (now: Date): Prisma.AnnouncementWhereInput => ({
  publishedAt: { lte: now },
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
});

/** Every current announcement that reaches the caller, pinned first (FR-COMM-008/009). */
export async function feed(actor: ActorContext, q: { limit: number; unread?: boolean }) {
  const viewer = await loadViewer(actor.userId);
  if (!viewer) throw new NotFoundError('User');
  const now = new Date();
  const where: Prisma.AnnouncementWhereInput = {
    AND: [live(now), { audiences: { some: { OR: audienceMatch(viewer) } } }],
  };
  const [rows, unread] = await Promise.all([
    prisma.announcement.findMany({
      where: q.unread ? { ...where, reads: { none: { userId: actor.userId } } } : where,
      include: { ...include, reads: { where: { userId: actor.userId }, select: { userId: true } } },
      orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
      take: q.limit,
    }),
    prisma.announcement.count({
      where: { ...where, reads: { none: { userId: actor.userId } } },
    }),
  ]);
  const read = new Set(rows.filter((r) => r.reads.length).map((r) => r.id));
  return { unread, items: await toDtos(rows, actor, read) };
}

async function visible(actor: ActorContext, id: string) {
  const a = await prisma.announcement.findUnique({ where: { id }, include });
  if (!a) throw new NotFoundError('Announcement');
  if (canManage(actor, a)) return a;
  const viewer = await loadViewer(actor.userId);
  const now = new Date();
  const match = viewer
    ? await prisma.announcement.count({
        where: { id, AND: [live(now), { audiences: { some: { OR: audienceMatch(viewer) } } }] },
      })
    : 0;
  if (!match) throw new NotFoundError('Announcement');
  return a;
}

export async function getAnnouncement(actor: ActorContext, id: string) {
  const a = await visible(actor, id);
  const read = await prisma.announcementRead.count({
    where: { announcementId: id, userId: actor.userId },
  });
  return (await toDtos([a], actor, read ? new Set([id]) : undefined))[0]!;
}

/** Read tracking (FR-COMM-008). */
export async function markAnnouncementRead(actor: ActorContext, id: string) {
  await visible(actor, id);
  await prisma.announcementRead.upsert({
    where: { announcementId_userId: { announcementId: id, userId: actor.userId } },
    create: { announcementId: id, userId: actor.userId },
    update: {},
  });
}

/** Announcements of one section for its instructors, administrators and students. */
export async function sectionAnnouncements(actor: ActorContext, sectionId: string) {
  const access = await sectionAccess(actor, sectionId);
  const staff =
    canInSection(actor, access, 'roster:read') ||
    canInSection(actor, access, 'announcement:publish_section');
  if (!staff && !(await isSectionStudent(actor, sectionId))) throw new NotFoundError('Section');
  const now = new Date();
  const rows = await prisma.announcement.findMany({
    where: {
      audiences: { some: { targetType: 'SECTION', targetId: sectionId } },
      ...(staff ? {} : live(now)),
    },
    include,
    orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
    take: 100,
  });
  return {
    canPublish: canInSection(actor, access, 'announcement:publish_section'),
    items: await toDtos(rows, actor),
  };
}
