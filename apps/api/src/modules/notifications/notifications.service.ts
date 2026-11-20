import type { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext } from '../../common/context/actor.js';
import { paging } from '../../common/http/list-query.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { getSocketEmitter, userRoom } from '../../infrastructure/sockets/socket-emitter.js';

export type NotificationCategory = Prisma.NotificationCreateManyInput['category'];

export interface NewNotification {
  userId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  link?: string | null;
}

/**
 * Writes notifications in the caller's transaction (FR-NOTIF-001) and returns
 * a function that pushes them to connected clients once the transaction has
 * committed (FR-NOTIF-002). Email delivery arrives with Phase 9.
 */
export async function queueNotifications(
  tx: Pick<typeof prisma, 'notification'>,
  items: NewNotification[],
): Promise<() => void> {
  if (!items.length) return () => undefined;
  await tx.notification.createMany({ data: items.map((i) => ({ ...i, link: i.link ?? null })) });
  return () => pushNotifications(items);
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
export async function purgeOldNotifications(days = 180) {
  const cutoff = new Date(Date.now() - days * 24 * 3600_000);
  const result = await prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return result.count;
}
