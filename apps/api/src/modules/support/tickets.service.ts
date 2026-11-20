import {
  ErrorCode,
  TICKET_REOPEN_DAYS,
  type ticketCreateSchema,
  type ticketListQuerySchema,
  type ticketReplySchema,
  type TicketStatus,
  type ticketUpdateSchema,
} from '@ucrams/shared';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext } from '../../common/context/actor.js';
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
} from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { storage } from '../../infrastructure/storage/index.js';
import { recordAudit } from '../audit/audit.service.js';
import { departmentOf, loadPerson, portalOf } from '../messaging/people.js';
import {
  queueNotifications,
  type NewNotification,
} from '../notifications/notifications.service.js';
import { nextSequence } from '../users/id-sequences.js';
import { assertAssignable, departmentScope, isManager, managesDepartment } from './case-access.js';

const PERMISSION = 'ticket:manage' as const;
const REOPEN_MS = TICKET_REOPEN_DAYS * 24 * 3600_000;
const ACTIVE: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_USER'];
type Tx = Prisma.TransactionClient;

const person = { select: { id: true, firstName: true, lastName: true, email: true } } as const;
const include = {
  owner: person,
  assignee: person,
  department: { select: { id: true, code: true, name: true } },
} satisfies Prisma.SupportTicketInclude;
type Row = Prisma.SupportTicketGetPayload<{ include: typeof include }>;
const name = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;

function dto(t: Row, actor: ActorContext, manager: boolean) {
  const reopenUntil =
    t.status === 'RESOLVED' && t.resolvedAt ? new Date(t.resolvedAt.getTime() + REOPEN_MS) : null;
  const mine = t.ownerId === actor.userId;
  return {
    id: t.id,
    ticketNumber: t.ticketNumber,
    category: t.category,
    priority: t.priority,
    subject: t.subject,
    description: t.description,
    status: t.status,
    owner: { id: t.owner.id, name: name(t.owner), email: t.owner.email },
    mine,
    department: t.department,
    assignee: t.assignee ? { id: t.assignee.id, name: name(t.assignee) } : null,
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
    closedAt: t.closedAt?.toISOString() ?? null,
    reopenUntil: reopenUntil?.toISOString() ?? null,
    canManage: manager,
    canReopen: mine && !!reopenUntil && reopenUntil.getTime() > Date.now(),
    canReply: t.status !== 'CLOSED' && (manager || t.status !== 'RESOLVED'),
    lastActivityAt: t.lastActivityAt.toISOString(),
    createdAt: t.createdAt.toISOString(),
  };
}

async function claimFiles(actor: ActorContext, fileIds: string[]) {
  if (!fileIds.length) return;
  const files = await prisma.storedFile.findMany({
    where: { id: { in: fileIds } },
    include: { ticketAttachment: true },
  });
  for (const id of fileIds) {
    const f = files.find((x) => x.id === id);
    if (!f || f.ownerId !== actor.userId || f.context !== 'TICKET' || f.ticketAttachment)
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

/** TCK-YYYY-000123 from a per-year sequence (FR-COMM-013). */
async function ticketNumber(tx: Tx) {
  const year = new Date().getUTCFullYear();
  const n = await nextSequence(`ticket:${year}`, tx);
  return `TCK-${year}-${String(n).padStart(6, '0')}`;
}

export async function createTicket(
  actor: ActorContext,
  input: z.output<typeof ticketCreateSchema>,
) {
  await claimFiles(actor, input.fileIds);
  const me = await loadPerson(actor.userId);
  const departmentId = (me && departmentOf(me)?.departmentId) ?? null;
  const t = await prisma.$transaction(async (tx) => {
    const created = await tx.supportTicket.create({
      data: {
        ticketNumber: await ticketNumber(tx),
        ownerId: actor.userId,
        departmentId,
        category: input.category,
        priority: input.priority,
        subject: input.subject,
        description: input.description,
        attachments: { create: input.fileIds.map((fileId) => ({ fileId })) },
        events: { create: { actorId: actor.userId, type: 'CREATED', toValue: 'OPEN' } },
      },
      include,
    });
    await recordAudit(
      actor,
      {
        action: 'ticket.created',
        entityType: 'SupportTicket',
        entityId: created.id,
        changes: { ticketNumber: created.ticketNumber, category: created.category },
      },
      tx,
    );
    return created;
  });
  return dto(t, actor, false);
}

export async function listTickets(
  actor: ActorContext,
  q: z.output<typeof ticketListQuerySchema>,
  box: 'mine' | 'manage',
) {
  if (box === 'manage' && !isManager(actor, PERMISSION)) throw new ForbiddenError();
  const where: Prisma.SupportTicketWhereInput = {
    ...(box === 'mine' ? { ownerId: actor.userId } : departmentScope(actor, PERMISSION)),
    ...(q.status === 'ACTIVE' ? { status: { in: ACTIVE } } : q.status ? { status: q.status } : {}),
    ...(q.category ? { category: q.category } : {}),
    ...(q.assignedToMe ? { assigneeId: actor.userId } : {}),
    ...(q.q
      ? {
          AND: [
            {
              OR: [
                { ticketNumber: { contains: q.q, mode: 'insensitive' as const } },
                { subject: { contains: q.q, mode: 'insensitive' as const } },
              ],
            },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.supportTicket.count({ where }),
    prisma.supportTicket.findMany({
      where,
      include,
      orderBy: [{ lastActivityAt: 'desc' }],
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
  ]);
  return { total, items: rows.map((t) => dto(t, actor, box === 'manage')) };
}

async function load(actor: ActorContext, id: string) {
  const t = await prisma.supportTicket.findUnique({ where: { id }, include });
  if (!t) throw new NotFoundError('Ticket');
  const manager = await managesDepartment(actor, PERMISSION, t.departmentId);
  if (!manager && t.ownerId !== actor.userId) throw new NotFoundError('Ticket');
  return { t, manager };
}

/** Owners never see internal notes or attachments added to them (FR-COMM-014). */
export async function getTicket(actor: ActorContext, id: string) {
  const { t, manager } = await load(actor, id);
  const [responses, events, attachments] = await Promise.all([
    prisma.ticketResponse.findMany({
      where: { ticketId: id, ...(manager ? {} : { internal: false }) },
      include: { author: person },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.ticketEvent.findMany({
      where: { ticketId: id },
      include: { actor: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.ticketAttachment.findMany({
      where: {
        ticketId: id,
        ...(manager ? {} : { OR: [{ responseId: null }, { response: { internal: false } }] }),
      },
      include: {
        file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } },
      },
    }),
  ]);
  const files = (responseId: string | null) =>
    attachments
      .filter((a) => a.responseId === responseId)
      .map((a) => ({
        fileId: a.file.id,
        name: a.file.originalName,
        mimeType: a.file.mimeType,
        sizeBytes: Number(a.file.sizeBytes),
      }));
  return {
    ...dto(t, actor, manager),
    attachments: files(null),
    responses: responses.map((r) => ({
      id: r.id,
      body: r.body,
      internal: r.internal,
      author: name(r.author),
      fromOwner: r.authorId === t.ownerId,
      attachments: files(r.id),
      createdAt: r.createdAt.toISOString(),
    })),
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      fromValue: e.fromValue,
      toValue: e.toValue,
      actor: e.actor ? name(e.actor) : 'System',
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

function ownerNotice(t: Row, title: string, body: string, portal: string): NewNotification {
  return {
    userId: t.ownerId,
    category: 'TICKET',
    title: `${t.ticketNumber}: ${title}`.slice(0, 200),
    body: body.slice(0, 300),
    link: `/${portal}/support/${t.id}`,
  };
}

const staffNotice = (t: Row, userId: string, title: string, body: string): NewNotification => ({
  userId,
  category: 'TICKET',
  title: `${t.ticketNumber}: ${title}`.slice(0, 200),
  body: body.slice(0, 300),
  link: `/admin/tickets/${t.id}`,
});

/** Status change with history and the resolved/closed timestamps the table constraint expects. */
async function changeStatus(tx: Tx, t: Row, to: TicketStatus, actorId: string | null) {
  if (to === t.status) return;
  const now = new Date();
  await tx.supportTicket.update({
    where: { id: t.id },
    data: {
      status: to,
      lastActivityAt: now,
      ...(to === 'RESOLVED' ? { resolvedAt: now, closedAt: null } : {}),
      ...(to === 'CLOSED' ? { closedAt: now } : {}),
      ...(ACTIVE.includes(to) ? { resolvedAt: null, closedAt: null } : {}),
    },
  });
  await tx.ticketEvent.create({
    data: { ticketId: t.id, actorId, type: 'STATUS_CHANGED', fromValue: t.status, toValue: to },
  });
}

const STATUS_TEXT: Record<TicketStatus, string> = {
  OPEN: 'reopened',
  IN_PROGRESS: 'being worked on',
  WAITING_ON_USER: 'waiting for your reply',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
};

export async function replyToTicket(
  actor: ActorContext,
  id: string,
  input: z.output<typeof ticketReplySchema>,
) {
  const { t, manager } = await load(actor, id);
  const fromOwner = t.ownerId === actor.userId && !manager;
  if ((input.internal || input.status) && !manager) throw new ForbiddenError();
  if (t.status === 'CLOSED')
    throw new BusinessRuleError(ErrorCode.INVALID_STATE_TRANSITION, 'This ticket is closed');
  if (fromOwner && t.status === 'RESOLVED')
    throw new BusinessRuleError(ErrorCode.INVALID_STATE_TRANSITION, 'Reopen the ticket to reply');
  await claimFiles(actor, input.fileIds);
  const owner = await loadPerson(t.ownerId);
  let after: () => void = () => undefined;
  await prisma.$transaction(async (tx) => {
    await tx.ticketResponse.create({
      data: {
        ticketId: id,
        authorId: actor.userId,
        body: input.body,
        internal: input.internal,
        attachments: {
          create: input.fileIds.map((fileId) => ({ ticketId: id, fileId })),
        },
      },
    });
    await tx.supportTicket.update({ where: { id }, data: { lastActivityAt: new Date() } });
    let status = input.status;
    // An owner replying to a ticket that waits on them hands it back to the team.
    if (fromOwner && t.status === 'WAITING_ON_USER') status = 'IN_PROGRESS';
    if (status) await changeStatus(tx, t, status, actor.userId);

    const notices: NewNotification[] = [];
    if (!fromOwner && !input.internal && owner && t.ownerId !== actor.userId)
      notices.push(
        ownerNotice(
          t,
          status && status !== t.status ? `Reply — ticket ${STATUS_TEXT[status]}` : 'New reply',
          input.body,
          portalOf(owner),
        ),
      );
    if (fromOwner && t.assigneeId)
      notices.push(staffNotice(t, t.assigneeId, 'The requester replied', input.body));
    after = await queueNotifications(tx, notices);
  });
  after();
  return getTicket(actor, id);
}

export async function updateTicket(
  actor: ActorContext,
  id: string,
  input: z.output<typeof ticketUpdateSchema>,
) {
  const { t, manager } = await load(actor, id);
  if (!manager) throw new ForbiddenError();
  if (input.assigneeId) await assertAssignable(input.assigneeId, PERMISSION, t.departmentId);
  const owner = await loadPerson(t.ownerId);
  let after: () => void = () => undefined;
  await prisma.$transaction(async (tx) => {
    const notices: NewNotification[] = [];
    if (input.status && input.status !== t.status) {
      await changeStatus(tx, t, input.status, actor.userId);
      if (owner)
        notices.push(
          ownerNotice(t, `Ticket ${STATUS_TEXT[input.status]}`, t.subject, portalOf(owner)),
        );
    }
    if (input.priority && input.priority !== t.priority) {
      await tx.supportTicket.update({ where: { id }, data: { priority: input.priority } });
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          actorId: actor.userId,
          type: 'PRIORITY_CHANGED',
          fromValue: t.priority,
          toValue: input.priority,
        },
      });
    }
    if (input.assigneeId !== undefined && input.assigneeId !== t.assigneeId) {
      await tx.supportTicket.update({ where: { id }, data: { assigneeId: input.assigneeId } });
      const assignee = input.assigneeId
        ? await tx.user.findUnique({
            where: { id: input.assigneeId },
            select: { firstName: true, lastName: true },
          })
        : null;
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          actorId: actor.userId,
          type: 'ASSIGNED',
          fromValue: t.assignee ? name(t.assignee).slice(0, 60) : null,
          toValue: assignee ? name(assignee).slice(0, 60) : null,
        },
      });
      if (input.assigneeId && input.assigneeId !== actor.userId)
        notices.push(staffNotice(t, input.assigneeId, 'Assigned to you', t.subject));
    }
    after = await queueNotifications(tx, notices);
    await recordAudit(
      actor,
      {
        action: 'ticket.updated',
        entityType: 'SupportTicket',
        entityId: id,
        changes: input as never,
      },
      tx,
    );
  });
  after();
  return getTicket(actor, id);
}

/** The owner may reopen within 7 days of resolution (FR-COMM-014). */
export async function reopenTicket(actor: ActorContext, id: string) {
  const { t } = await load(actor, id);
  if (t.ownerId !== actor.userId) throw new ForbiddenError();
  if (t.status !== 'RESOLVED' || !t.resolvedAt || Date.now() - t.resolvedAt.getTime() > REOPEN_MS)
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      `Resolved tickets can be reopened for ${TICKET_REOPEN_DAYS} days`,
    );
  let after: () => void = () => undefined;
  await prisma.$transaction(async (tx) => {
    await tx.supportTicket.update({
      where: { id },
      data: { status: 'OPEN', resolvedAt: null, closedAt: null, lastActivityAt: new Date() },
    });
    await tx.ticketEvent.create({
      data: {
        ticketId: id,
        actorId: actor.userId,
        type: 'REOPENED',
        fromValue: 'RESOLVED',
        toValue: 'OPEN',
      },
    });
    if (t.assigneeId)
      after = await queueNotifications(tx, [
        staffNotice(t, t.assigneeId, 'Reopened by the requester', t.subject),
      ]);
  });
  after();
  return getTicket(actor, id);
}

/** Resolved tickets close once the reopen window has passed (daily job). */
export async function closeResolvedTickets() {
  const cutoff = new Date(Date.now() - REOPEN_MS);
  const due = await prisma.supportTicket.findMany({
    where: { status: 'RESOLVED', resolvedAt: { lt: cutoff } },
    include,
    take: 500,
  });
  for (const t of due) await prisma.$transaction((tx) => changeStatus(tx, t, 'CLOSED', null));
  return { closed: due.length };
}

export async function attachmentLink(actor: ActorContext, id: string, fileId: string) {
  const { manager } = await load(actor, id);
  const a = await prisma.ticketAttachment.findUnique({
    where: { fileId },
    include: { file: true, response: { select: { internal: true } } },
  });
  if (!a || a.ticketId !== id || (a.response?.internal && !manager))
    throw new NotFoundError('Attachment');
  const url = await storage.createDownloadUrl(a.file.storageKey, {
    expiresInSeconds: 300,
    filename: a.file.originalName,
    disposition: 'attachment',
  });
  return { url, expiresInSeconds: 300 };
}
