import {
  DEFAULT_CHANNELS,
  ErrorCode,
  MANDATORY_CHANNELS,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationCategory as NotificationCategoryKey,
  type NotificationChannel,
} from '@ucrams/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext } from '../../common/context/actor.js';
import { BusinessRuleError } from '../../common/exceptions/app-error.js';
import { enqueueEmail } from '../../infrastructure/email/outbox.js';
import { digestEmail, notificationEmail } from '../../infrastructure/email/templates.js';
import { paging } from '../../common/http/list-query.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { getSetting } from '../platform/settings.service.js';
import { getSocketEmitter, userRoom } from '../../infrastructure/sockets/socket-emitter.js';

export type NotificationCategory = Prisma.NotificationCreateManyInput['category'];
type Tx = Prisma.TransactionClient | typeof prisma;

export interface NewNotification {
  userId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  link?: string | null;
}

/** Whether each channel is on for each user and category, applying defaults and mandatory channels. */
export async function deliveryChannels(
  tx: Tx,
  userIds: string[],
  categories: NotificationCategory[],
) {
  const rows = userIds.length
    ? await tx.notificationPreference.findMany({
        where: {
          userId: { in: [...new Set(userIds)] },
          category: { in: [...new Set(categories)] },
        },
      })
    : [];
  const chosen = new Map(rows.map((r) => [`${r.userId}:${r.category}:${r.channel}`, r.enabled]));
  return (userId: string, category: NotificationCategory, channel: NotificationChannel) =>
    MANDATORY_CHANNELS[category]?.includes(channel) ||
    (chosen.get(`${userId}:${category}:${channel}`) ?? DEFAULT_CHANNELS[category][channel]);
}

/**
 * Writes notifications in the caller's transaction (FR-NOTIF-001) and returns
 * a function to call once it has committed: it pushes them to connected
 * clients (FR-NOTIF-002) and queues emails for users who receive this
 * category by email (FR-NOTIF-004/005). `forceEmail` covers urgent notices.
 */
export async function queueNotifications(
  tx: Tx,
  items: NewNotification[],
  opts: { forceEmail?: boolean } = {},
): Promise<() => void> {
  if (!items.length) return () => undefined;
  const enabled = await deliveryChannels(
    tx,
    items.map((i) => i.userId),
    items.map((i) => i.category),
  );
  const inApp = items.filter((i) => enabled(i.userId, i.category, 'IN_APP'));
  const byEmail = items.filter((i) => opts.forceEmail || enabled(i.userId, i.category, 'EMAIL'));
  if (inApp.length)
    await tx.notification.createMany({ data: inApp.map((i) => ({ ...i, link: i.link ?? null })) });
  const users = byEmail.length
    ? await tx.user.findMany({
        where: { id: { in: [...new Set(byEmail.map((i) => i.userId))] }, status: 'ACTIVE' },
        select: { id: true, email: true, firstName: true, emailDigest: true },
      })
    : [];
  const recipients = new Map(users.map((u) => [u.id, u]));
  // Digest users get mandatory and urgent notices now; the rest wait for the daily digest.
  const immediate = (i: NewNotification, digest: boolean) =>
    !digest || opts.forceEmail || (MANDATORY_CHANNELS[i.category]?.includes('EMAIL') ?? false);
  return () => {
    pushNotifications(inApp);
    for (const i of byEmail) {
      const u = recipients.get(i.userId);
      if (u && immediate(i, u.emailDigest))
        void enqueueEmail(
          notificationEmail(u.email, u.firstName, i.title, i.body, i.link ?? null),
          `notification:${i.category.toLowerCase()}`,
        );
    }
  };
}

export function pushNotifications(items: NewNotification[]) {
  try {
    const emitter = getSocketEmitter();
    for (const n of items)
      emitter.to(userRoom(n.userId)).emit('notification:new', {
        category: n.category,
        title: n.title,
        body: n.body,
        link: n.link ?? null,
      });
  } catch (err) {
    // Delivery is best effort: the notification is stored either way.
    logger.warn({ err }, 'Failed to push notifications');
  }
}

// ----- preferences (FR-NOTIF-004) ----------------------------------------------------

export async function getPreferences(actor: ActorContext) {
  const rows = await prisma.notificationPreference.findMany({ where: { userId: actor.userId } });
  const chosen = new Map(rows.map((r) => [`${r.category}:${r.channel}`, r.enabled]));
  return NOTIFICATION_CATEGORIES.map((category) => ({
    category,
    channels: NOTIFICATION_CHANNELS.map((channel) => {
      const mandatory = MANDATORY_CHANNELS[category]?.includes(channel) ?? false;
      return {
        channel,
        mandatory,
        enabled:
          mandatory ||
          (chosen.get(`${category}:${channel}`) ?? DEFAULT_CHANNELS[category][channel]),
      };
    }),
  }));
}

export async function updatePreferences(
  actor: ActorContext,
  input: {
    preferences: Array<{
      category: NotificationCategoryKey;
      channel: NotificationChannel;
      enabled: boolean;
    }>;
  },
) {
  const locked = input.preferences.filter(
    (p) => !p.enabled && MANDATORY_CHANNELS[p.category]?.includes(p.channel),
  );
  if (locked.length)
    throw new BusinessRuleError(
      ErrorCode.VALIDATION_ERROR,
      'Some notifications cannot be switched off',
      {
        fields: locked.map((p) => ({
          path: 'body.preferences',
          message: `${p.category} ${p.channel === 'EMAIL' ? 'email' : 'in-app'} notifications are mandatory`,
        })),
      },
    );
  await prisma.$transaction(
    input.preferences.map((p) =>
      prisma.notificationPreference.upsert({
        where: {
          userId_category_channel: {
            userId: actor.userId,
            category: p.category,
            channel: p.channel,
          },
        },
        create: { userId: actor.userId, ...p },
        update: { enabled: p.enabled },
      }),
    ),
  );
  return getPreferences(actor);
}

const dto = (n: {
  id: string;
  category: string;
  title: string;
  body: string;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}) => ({
  id: n.id,
  category: n.category,
  title: n.title,
  body: n.body,
  link: n.link,
  readAt: n.readAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
});

export async function listNotifications(
  actor: ActorContext,
  q: { page: number; limit: number; unread?: boolean },
) {
  const where = { userId: actor.userId, ...(q.unread ? { readAt: null } : {}) };
  const [total, rows] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...paging(q) }),
  ]);
  return { total, items: rows.map(dto) };
}

export async function unreadCount(actor: ActorContext) {
  return {
    unread: await prisma.notification.count({ where: { userId: actor.userId, readAt: null } }),
  };
}

export async function markRead(actor: ActorContext, input: { ids?: string[]; all?: boolean }) {
  const result = await prisma.notification.updateMany({
    where: {
      userId: actor.userId,
      readAt: null,
      ...(input.all ? {} : { id: { in: input.ids ?? [] } }),
    },
    data: { readAt: new Date() },
  });
  return { updated: result.count };
}

/** Notifications older than 180 days are removed (FR-NOTIF-003). */
export async function purgeOldNotifications(days?: number): Promise<number> {
  days ??= await getSetting('notifications.retentionDays');
  const cutoff = new Date(Date.now() - days * 24 * 3600_000);
  const result = await prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return result.count;
}

// ----- daily digest (FR-NOTIF-006) --------------------------------------------------------

const DAY_MS = 24 * 3600_000;

export async function getDigest(actor: ActorContext) {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: { emailDigest: true, lastDigestAt: true },
  });
  return { enabled: u.emailDigest, lastSentAt: u.lastDigestAt?.toISOString() ?? null };
}

export async function setDigest(actor: ActorContext, enabled: boolean) {
  await prisma.user.update({
    where: { id: actor.userId },
    // Starting now means the first digest covers only what arrives from here on.
    data: { emailDigest: enabled, ...(enabled ? { lastDigestAt: new Date() } : {}) },
  });
  return getDigest(actor);
}

/**
 * Hourly job: every digest user whose last digest is a day old gets one email
 * listing the notifications they would otherwise have been emailed (unread,
 * email channel on, not already sent immediately). Nothing to report: no email.
 */
export async function sendDigests(now = new Date()) {
  const due = await prisma.user.findMany({
    where: {
      emailDigest: true,
      status: 'ACTIVE',
      OR: [
        { lastDigestAt: null },
        { lastDigestAt: { lte: new Date(now.getTime() - DAY_MS + 60_000) } },
      ],
    },
    select: { id: true, email: true, firstName: true, lastDigestAt: true },
    take: 500,
  });
  let sent = 0;
  for (const u of due) {
    const since = u.lastDigestAt ?? new Date(now.getTime() - DAY_MS);
    const rows = await prisma.notification.findMany({
      where: { userId: u.id, readAt: null, createdAt: { gt: since, lte: now } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const enabled = await deliveryChannels(
      prisma,
      [u.id],
      rows.map((r) => r.category),
    );
    const items = rows.filter(
      (r) =>
        enabled(u.id, r.category, 'EMAIL') &&
        !(MANDATORY_CHANNELS[r.category]?.includes('EMAIL') ?? false),
    );
    // Claim first so two workers never send the same digest.
    const claimed = await prisma.user.updateMany({
      where: { id: u.id, lastDigestAt: u.lastDigestAt },
      data: { lastDigestAt: now },
    });
    if (!claimed.count || !items.length) continue;
    await enqueueEmail(
      digestEmail(
        u.email,
        u.firstName,
        items.map((i) => ({ title: i.title, body: i.body, link: i.link })),
      ),
      'notification:digest',
    );
    sent++;
  }
  return { users: due.length, sent };
}
