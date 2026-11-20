import {
  ErrorCode,
  MESSAGE_EDIT_WINDOW_MINUTES,
  type conversationSettingsSchema,
  type directConversationSchema,
  type messageCreateSchema,
} from '@ucrams/shared';
import type { z } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext } from '../../common/context/actor.js';
import {
  AppError,
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
} from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { storage } from '../../infrastructure/storage/index.js';
import {
  queueNotifications,
  type NewNotification,
} from '../notifications/notifications.service.js';
import {
  conversationAccess,
  emitTo,
  supportOwnerFilter,
  supportScope,
  syncMySectionConversations,
} from './conversation-access.js';
import {
  canContact,
  CURRENT_SESSION,
  kindOf,
  loadPeople,
  loadPerson,
  portalOf,
  RUNNING_SECTION,
  SEAT_HOLDING,
} from './people.js';

const EDIT_WINDOW_MS = MESSAGE_EDIT_WINDOW_MINUTES * 60_000;

const notAllowed = (message: string) => new AppError(403, ErrorCode.MESSAGING_NOT_ALLOWED, message);

// ----- DTOs ------------------------------------------------------------------------

const conversationInclude = {
  section: {
    select: {
      id: true,
      sectionCode: true,
      course: { select: { code: true, title: true } },
      session: { select: { name: true } },
    },
  },
  supportOwner: { select: { id: true, firstName: true, lastName: true } },
  participants: {
    where: { leftAt: null },
    select: {
      userId: true,
      role: true,
      muted: true,
      user: { select: { firstName: true, lastName: true } },
    },
  },
  messages: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: {
      body: true,
      deletedAt: true,
      createdAt: true,
      senderId: true,
      sender: { select: { firstName: true, lastName: true } },
      _count: { select: { attachments: true } },
    },
  },
} satisfies Prisma.ConversationInclude;
type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof conversationInclude }>;

const messageInclude = {
  sender: { select: { id: true, firstName: true, lastName: true } },
  attachments: {
    select: { file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } } },
  },
} satisfies Prisma.MessageInclude;
type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

function conversationDto(
  c: ConversationRow,
  actor: ActorContext,
  extra: { unread: number; moderator: boolean },
) {
  const me = c.participants.find((p) => p.userId === actor.userId);
  const others = c.participants.filter((p) => p.userId !== actor.userId);
  const ownerName = c.supportOwner
    ? `${c.supportOwner.firstName} ${c.supportOwner.lastName}`
    : null;
  const title =
    c.type === 'SECTION'
      ? `${c.section!.course.code} ${c.section!.sectionCode} · ${c.section!.course.title}`
      : c.type === 'SUPPORT'
        ? c.supportOwnerId === actor.userId
          ? 'University support'
          : `Support: ${ownerName}`
        : others.map((o) => `${o.user.firstName} ${o.user.lastName}`).join(', ') ||
          'Former participant';
  const last = c.messages[0];
  return {
    id: c.id,
    type: c.type,
    title,
    subtitle:
      c.type === 'SECTION'
        ? `${c.section!.session.name} · ${c.participants.length} members`
        : c.type === 'SUPPORT'
          ? c.supportOwnerId === actor.userId
            ? 'Questions for university administrators'
            : 'Support inbox'
          : null,
    section: c.section
      ? { id: c.section.id, label: `${c.section.course.code} ${c.section.sectionCode}` }
      : null,
    announcementOnly: c.announcementOnly,
    muted: me?.muted ?? false,
    member: !!me,
    unread: extra.unread,
    canPost: !c.announcementOnly || extra.moderator,
    canModerate: extra.moderator,
    lastMessage: last
      ? {
          preview: last.deletedAt
            ? 'Message deleted'
            : last.body.slice(0, 140) ||
              `${last._count.attachments} attachment${last._count.attachments === 1 ? '' : 's'}`,
          sender:
            last.senderId === actor.userId
              ? 'You'
              : `${last.sender.firstName} ${last.sender.lastName}`,
          createdAt: last.createdAt.toISOString(),
        }
      : null,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    participants: (c.type === 'SECTION' ? [] : others).map((p) => ({
      userId: p.userId,
      name: `${p.user.firstName} ${p.user.lastName}`,
      role: p.role,
    })),
  };
}

function messageDto(m: MessageRow, actorId: string, moderator = false) {
  const deleted = !!m.deletedAt;
  const mine = m.senderId === actorId;
  return {
    id: m.id,
    conversationId: m.conversationId,
    sender: { id: m.sender.id, name: `${m.sender.firstName} ${m.sender.lastName}` },
    body: deleted ? null : m.body,
    deleted,
    editedAt: m.editedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    mine,
    canEdit: mine && !deleted && Date.now() - m.createdAt.getTime() < EDIT_WINDOW_MS,
    canDelete: !deleted && (mine || moderator),
    attachments: deleted
      ? []
      : m.attachments.map((a) => ({
          fileId: a.file.id,
          name: a.file.originalName,
          mimeType: a.file.mimeType,
          sizeBytes: Number(a.file.sizeBytes),
        })),
  };
}
export type MessageDto = ReturnType<typeof messageDto>;

/** Unread messages per conversation: newer than the read pointer, from someone else, not deleted. */
async function unreadCounts(userId: string, conversationIds?: string[]) {
  const rows = await prisma.$queryRaw<Array<{ conversation_id: string; unread: bigint }>>`
    SELECT cp.conversation_id, count(m.id) AS unread
    FROM conversation_participants cp
    JOIN messages m ON m.conversation_id = cp.conversation_id
      AND m.sender_id <> cp.user_id
      AND m.deleted_at IS NULL
      AND m.created_at > coalesce(cp.last_read_at, cp.joined_at)
    WHERE cp.user_id = ${userId}::uuid AND cp.left_at IS NULL
      ${conversationIds ? Prisma.sql`AND cp.conversation_id = ANY(${conversationIds}::uuid[])` : Prisma.empty}
    GROUP BY cp.conversation_id`;
  return new Map(rows.map((r) => [r.conversation_id, Number(r.unread)]));
}

// ----- conversations ----------------------------------------------------------------

export async function listConversations(actor: ActorContext, box: 'mine' | 'support') {
  if (box === 'support') {
    const scope = supportScope(actor);
    if (scope === undefined) throw new ForbiddenError();
    const rows = await prisma.conversation.findMany({
      where: {
        type: 'SUPPORT',
        lastMessageAt: { not: null },
        ...(scope ? { supportOwner: supportOwnerFilter(scope) } : {}),
      },
      include: conversationInclude,
      orderBy: { lastMessageAt: 'desc' },
      take: 200,
    });
    const unread = await unreadCounts(
      actor.userId,
      rows.map((r) => r.id),
    );
    return rows.map((c) =>
      conversationDto(c, actor, { unread: unread.get(c.id) ?? 0, moderator: true }),
    );
  }
  await syncMySectionConversations(actor.userId);
  const rows = await prisma.conversation.findMany({
    where: { participants: { some: { userId: actor.userId, leftAt: null } } },
    include: conversationInclude,
    orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: 200,
  });
  const unread = await unreadCounts(actor.userId);
  return rows.map((c) => {
    const me = c.participants.find((p) => p.userId === actor.userId);
    const moderator =
      (c.type === 'SECTION' && me?.role === 'MODERATOR') ||
      (c.type === 'SUPPORT' && c.supportOwnerId !== actor.userId);
    return conversationDto(c, actor, { unread: unread.get(c.id) ?? 0, moderator });
  });
}

export async function getConversation(actor: ActorContext, id: string) {
  const access = await conversationAccess(actor, id);
  const row = await prisma.conversation.findUniqueOrThrow({
    where: { id },
    include: conversationInclude,
  });
  const unread = access.participant ? await unreadCounts(actor.userId, [id]) : new Map();
  return conversationDto(row, actor, { unread: unread.get(id) ?? 0, moderator: access.moderator });
}

export async function unreadSummary(actor: ActorContext) {
  const [unread, muted] = await Promise.all([
    unreadCounts(actor.userId),
    prisma.conversationParticipant.findMany({
      where: { userId: actor.userId, muted: true, leftAt: null },
      select: { conversationId: true },
    }),
  ]);
  const mutedIds = new Set(muted.map((m) => m.conversationId));
  let total = 0;
  for (const [id, n] of unread) if (!mutedIds.has(id)) total += n;
  return { total };
}

export async function updateSettings(
  actor: ActorContext,
  id: string,
  input: z.output<typeof conversationSettingsSchema>,
) {
  const access = await conversationAccess(actor, id);
  if (input.announcementOnly !== undefined) {
    if (access.conversation.type !== 'SECTION' || !access.moderator) throw new ForbiddenError();
    await prisma.conversation.update({
      where: { id },
      data: { announcementOnly: input.announcementOnly },
    });
  }
  if (input.muted !== undefined) {
    if (!access.participant) throw new ForbiddenError('Only members can mute a conversation');
    await prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId: id, userId: actor.userId } },
      data: { muted: input.muted },
    });
  }
  return getConversation(actor, id);
}

export async function markConversationRead(actor: ActorContext, id: string) {
  const access = await conversationAccess(actor, id);
  if (!access.participant) return { unread: 0 };
  const last = await prisma.message.findFirst({
    where: { conversationId: id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true },
  });
  await prisma.conversationParticipant.update({
    where: { conversationId_userId: { conversationId: id, userId: actor.userId } },
    data: { lastReadAt: new Date(), lastReadMessageId: last?.id ?? null },
  });
  emitTo([actor.userId], 'conversation:read', { conversationId: id });
  return { unread: 0 };
}

// ----- messages ----------------------------------------------------------------------

export async function listMessages(
  actor: ActorContext,
  id: string,
  q: { before?: string; limit: number },
) {
  const access = await conversationAccess(actor, id);
  let cursor: { createdAt: Date; id: string } | null = null;
  if (q.before) {
    cursor = await prisma.message.findFirst({
      where: { id: q.before, conversationId: id },
      select: { createdAt: true, id: true },
    });
    if (!cursor) throw new NotFoundError('Message');
  }
  const rows = await prisma.message.findMany({
    where: {
      conversationId: id,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    include: messageInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
  });
  const hasMore = rows.length > q.limit;
  return {
    hasMore,
    items: rows
      .slice(0, q.limit)
      .reverse()
      .map((m) => messageDto(m, actor.userId, access.moderator)),
  };
}

async function claimAttachments(actor: ActorContext, fileIds: string[]) {
  if (!fileIds.length) return;
  const files = await prisma.storedFile.findMany({
    where: { id: { in: fileIds } },
    include: { messageAttachment: true },
  });
  for (const id of fileIds) {
    const f = files.find((x) => x.id === id);
    if (!f || f.ownerId !== actor.userId || f.context !== 'MESSAGE' || f.messageAttachment)
      throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Upload the attachment first', {
        fields: [{ path: 'body.fileIds', message: 'Unknown upload' }],
      });
    if (f.status !== 'READY')
      throw new BusinessRuleError(
        ErrorCode.FILE_NOT_READY,
        'An attachment has not finished uploading',
      );
  }
}

/**
 * Stores a message and delivers it (FR-COMM-001/004). Direct and support
 * recipients get one notification when a conversation goes from read to
 * unread, not one per message; muted members get none.
 */
export async function sendMessage(
  actor: ActorContext,
  id: string,
  input: z.output<typeof messageCreateSchema>,
) {
  const access = await conversationAccess(actor, id);
  const c = access.conversation;
  if (c.announcementOnly && !access.moderator)
    throw notAllowed('Only instructors can post in this conversation');
  await claimAttachments(actor, input.fileIds);

  let after: () => void = () => undefined;
  const now = new Date();
  const message = await prisma.$transaction(async (tx) => {
    const m = await tx.message.create({
      data: {
        conversationId: id,
        senderId: actor.userId,
        body: input.body,
        attachments: { create: input.fileIds.map((fileId) => ({ fileId })) },
      },
      include: messageInclude,
    });
    await tx.conversation.update({ where: { id }, data: { lastMessageAt: m.createdAt } });
    // Support staff join the conversation when they first answer it.
    await tx.conversationParticipant.upsert({
      where: { conversationId_userId: { conversationId: id, userId: actor.userId } },
      create: {
        conversationId: id,
        userId: actor.userId,
        role: access.moderator ? 'MODERATOR' : 'MEMBER',
        lastReadAt: now,
        lastReadMessageId: m.id,
      },
      update: { lastReadAt: now, lastReadMessageId: m.id, leftAt: null },
    });
    if (c.type !== 'SECTION') {
      const recipients = await tx.conversationParticipant.findMany({
        where: {
          conversationId: id,
          userId: { not: actor.userId },
          leftAt: null,
          muted: false,
        },
      });
      const caughtUp = recipients.filter(
        (r) => !c.lastMessageAt || (r.lastReadAt && r.lastReadAt >= c.lastMessageAt),
      );
      const people = await loadPeople([actor.userId, ...caughtUp.map((r) => r.userId)]);
      const sender = people.get(actor.userId)!;
      const notices: NewNotification[] = caughtUp.map((r) => {
        const person = people.get(r.userId);
        return {
          userId: r.userId,
          category: 'MESSAGE',
          title:
            c.type === 'SUPPORT' && c.supportOwnerId === r.userId
              ? 'University support replied'
              : `New message from ${sender.name}`,
          body: input.body.slice(0, 300) || 'Sent an attachment',
          link: `/${person ? portalOf(person) : 'admin'}/messages?c=${id}`,
        };
      });
      after = await queueNotifications(tx, notices);
    }
    return m;
  });
  after();
  const recipients = await prisma.conversationParticipant.findMany({
    where: { conversationId: id, leftAt: null },
    select: { userId: true },
  });
  emitTo(
    recipients.map((r) => r.userId),
    'message:new',
    { conversationId: id, messageId: message.id, senderId: actor.userId },
  );
  return messageDto(message, actor.userId, access.moderator);
}

async function ownMessage(actor: ActorContext, messageId: string) {
  const m = await prisma.message.findUnique({ where: { id: messageId } });
  if (!m) throw new NotFoundError('Message');
  const access = await conversationAccess(actor, m.conversationId);
  return { m, access };
}

export async function editMessage(actor: ActorContext, messageId: string, body: string) {
  const { m, access } = await ownMessage(actor, messageId);
  if (m.senderId !== actor.userId) throw new ForbiddenError('You can only edit your own messages');
  if (m.deletedAt) throw new NotFoundError('Message');
  if (Date.now() - m.createdAt.getTime() >= EDIT_WINDOW_MS)
    throw new BusinessRuleError(
      ErrorCode.EDIT_WINDOW_PASSED,
      `Messages can be edited for ${MESSAGE_EDIT_WINDOW_MINUTES} minutes after sending`,
    );
  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { body, editedAt: new Date() },
    include: messageInclude,
  });
  await broadcastChange(m.conversationId, 'message:updated', messageId);
  return messageDto(updated, actor.userId, access.moderator);
}

/** Authors delete their own messages; moderators may remove any in their conversation. */
export async function deleteMessage(actor: ActorContext, messageId: string) {
  const { m, access } = await ownMessage(actor, messageId);
  if (m.senderId !== actor.userId && !access.moderator) throw new ForbiddenError();
  if (!m.deletedAt)
    await prisma.message.update({ where: { id: messageId }, data: { deletedAt: new Date() } });
  await broadcastChange(m.conversationId, 'message:deleted', messageId);
}

async function broadcastChange(conversationId: string, event: string, messageId: string) {
  const members = await prisma.conversationParticipant.findMany({
    where: { conversationId, leftAt: null },
    select: { userId: true },
  });
  emitTo(
    members.map((p) => p.userId),
    event,
    { conversationId, messageId },
  );
}

export async function attachmentLink(actor: ActorContext, messageId: string, fileId: string) {
  const { m } = await ownMessage(actor, messageId);
  const a = await prisma.messageAttachment.findUnique({
    where: { messageId_fileId: { messageId, fileId } },
    include: { file: true },
  });
  if (!a || m.deletedAt) throw new NotFoundError('Attachment');
  const url = await storage.createDownloadUrl(a.file.storageKey, {
    expiresInSeconds: 300,
    filename: a.file.originalName,
    disposition: 'attachment',
  });
  return { url, expiresInSeconds: 300 };
}

// ----- starting conversations -------------------------------------------------------

/** Opens (or reuses) the direct conversation with another user and sends the first message. */
export async function startDirect(
  actor: ActorContext,
  input: z.output<typeof directConversationSchema>,
) {
  const directKey = [actor.userId, input.userId].sort().join(':');
  let conversation = await prisma.conversation.findUnique({ where: { directKey } });
  if (!conversation) {
    const people = await loadPeople([actor.userId, input.userId]);
    const me = people.get(actor.userId);
    const them = people.get(input.userId);
    if (!me || !them) throw new NotFoundError('User');
    if (!(await canContact(me, them)))
      throw notAllowed(
        me.student && them.isAdmin
          ? 'Contact administrators through University support'
          : 'You can only message people you teach, study with or work with',
      );
    conversation = await prisma.conversation.upsert({
      where: { directKey },
      create: {
        type: 'DIRECT',
        directKey,
        createdById: actor.userId,
        participants: {
          create: [
            { userId: actor.userId, lastReadAt: new Date() },
            { userId: input.userId, lastReadAt: new Date(0) },
          ],
        },
      },
      update: {},
    });
  } else {
    // Rejoin a conversation either side had left.
    await prisma.conversationParticipant.updateMany({
      where: { conversationId: conversation.id, leftAt: { not: null } },
      data: { leftAt: null },
    });
  }
  const message = await sendMessage(actor, conversation.id, { body: input.body, fileIds: [] });
  return { conversationId: conversation.id, message };
}

/** The caller's support conversation with administrators (FR-COMM-002), created on first use. */
export async function openSupport(actor: ActorContext, body: string) {
  const conversation = await prisma.conversation.upsert({
    where: { supportOwnerId: actor.userId },
    create: {
      type: 'SUPPORT',
      supportOwnerId: actor.userId,
      createdById: actor.userId,
      participants: { create: { userId: actor.userId, lastReadAt: new Date() } },
    },
    update: {},
  });
  const message = await sendMessage(actor, conversation.id, { body, fileIds: [] });
  return { conversationId: conversation.id, message };
}

// ----- contacts and search ---------------------------------------------------------------

/** People the caller may start a direct conversation with, filtered by name or email. */
export async function contacts(actor: ActorContext, q: string) {
  const me = await loadPerson(actor.userId);
  if (!me) throw new NotFoundError('User');
  const text = q
    ? {
        OR: [
          { firstName: { contains: q, mode: 'insensitive' as const } },
          { lastName: { contains: q, mode: 'insensitive' as const } },
          { email: { contains: q, mode: 'insensitive' as const } },
        ],
      }
    : {};
  const currentSection = { status: RUNNING_SECTION, session: CURRENT_SESSION };
  const or: Prisma.UserWhereInput[] = [];
  if (me.isAdmin) {
    if (q.length < 2) return [];
    or.push({});
  } else {
    if (me.faculty) {
      or.push({ roles: { some: { role: { scopeMode: 'ORGANIZATIONAL' } } } });
      or.push({
        student: {
          registrations: {
            some: {
              status: { in: [...SEAT_HOLDING] },
              section: {
                ...currentSection,
                instructors: { some: { facultyMember: { userId: me.id } } },
              },
            },
          },
        },
      });
    }
    if (me.student)
      or.push({
        facultyMember: {
          sectionAssignments: {
            some: {
              section: {
                ...currentSection,
                registrations: {
                  some: { status: { in: [...SEAT_HOLDING] }, student: { userId: me.id } },
                },
              },
            },
          },
        },
      });
  }
  if (!or.length) return [];
  const users = await prisma.user.findMany({
    where: { id: { not: me.id }, status: 'ACTIVE', AND: [text, { OR: or }] },
    select: { id: true },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    take: 20,
  });
  const people = await loadPeople(users.map((u) => u.id));
  return users.map((u) => {
    const p = people.get(u.id)!;
    return { userId: p.id, name: p.name, email: p.email, kind: kindOf(p) };
  });
}

/** Full-text search over the caller's own conversations (FR-COMM-006). */
export async function searchMessages(actor: ActorContext, q: string, limit: number) {
  const hits = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT m.id
    FROM messages m
    JOIN conversation_participants cp
      ON cp.conversation_id = m.conversation_id AND cp.user_id = ${actor.userId}::uuid AND cp.left_at IS NULL
    WHERE m.deleted_at IS NULL
      AND m.search_vector @@ websearch_to_tsquery('english', ${q})
    ORDER BY ts_rank(m.search_vector, websearch_to_tsquery('english', ${q})) DESC, m.created_at DESC
    LIMIT ${limit}`;
  if (!hits.length) return [];
  const rows = await prisma.message.findMany({
    where: { id: { in: hits.map((h) => h.id) } },
    include: { ...messageInclude, conversation: { include: conversationInclude } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return hits.map((h) => {
    const m = byId.get(h.id)!;
    const c = conversationDto(m.conversation, actor, { unread: 0, moderator: false });
    return { ...messageDto(m, actor.userId), conversationTitle: c.title };
  });
}
