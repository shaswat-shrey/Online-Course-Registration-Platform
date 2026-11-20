import {
  ErrorCode,
  type feedbackCreateSchema,
  type feedbackListQuerySchema,
  type feedbackUpdateSchema,
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
import { recordAudit } from '../audit/audit.service.js';
import { hasGlobal } from '../authz/authz.js';
import { departmentOf, loadPerson, portalOf } from '../messaging/people.js';
import {
  queueNotifications,
  type NewNotification,
} from '../notifications/notifications.service.js';
import { assertAssignable, departmentScope, isManager, managesDepartment } from './case-access.js';

const PERMISSION = 'feedback:manage' as const;
const person = { select: { id: true, firstName: true, lastName: true } } as const;
const include = {
  submittedBy: person,
  assignee: person,
  department: { select: { id: true, code: true, name: true } },
  course: { select: { id: true, code: true, title: true } },
  _count: { select: { responses: true } },
} satisfies Prisma.FeedbackInclude;
type Row = Prisma.FeedbackGetPayload<{ include: typeof include }>;

const name = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;

/** Anonymous feedback hides the submitter from everyone except the submitter and super administrators. */
function dto(f: Row, actor: ActorContext, manager: boolean) {
  const revealed =
    !f.anonymous || f.submittedById === actor.userId || hasGlobal(actor.grants, 'rbac:manage');
  return {
    id: f.id,
    category: f.category,
    subject: f.subject,
    description: f.description,
    priority: f.priority,
    status: f.status,
    anonymous: f.anonymous,
    submittedBy: revealed ? { id: f.submittedBy.id, name: name(f.submittedBy) } : null,
    mine: f.submittedById === actor.userId,
    department: f.department,
    course: f.course,
    assignee: f.assignee ? { id: f.assignee.id, name: name(f.assignee) } : null,
    resolutionNote: f.resolutionNote,
    resolvedAt: f.resolvedAt?.toISOString() ?? null,
    responseCount: f._count.responses,
    canManage: manager,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

export async function createFeedback(
  actor: ActorContext,
  input: z.output<typeof feedbackCreateSchema>,
) {
  let departmentId = input.departmentId;
  if (input.courseId) {
    const course = await prisma.course.findUnique({
      where: { id: input.courseId },
      select: { departmentId: true },
    });
    if (!course)
      throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Unknown course', {
        fields: [{ path: 'body.courseId', message: 'Unknown course' }],
      });
    departmentId ??= course.departmentId;
  }
  if (departmentId && !(await prisma.department.count({ where: { id: departmentId } })))
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Unknown department', {
      fields: [{ path: 'body.departmentId', message: 'Unknown department' }],
    });
  if (!departmentId) {
    // Route to the submitter's own department so its administrators see it.
    const me = await loadPerson(actor.userId);
    departmentId = (me && departmentOf(me)?.departmentId) ?? null;
  }
  const f = await prisma.feedback.create({
    data: {
      submittedById: actor.userId,
      anonymous: input.anonymous,
      category: input.category,
      subject: input.subject,
      description: input.description,
      priority: input.priority,
      departmentId,
      courseId: input.courseId,
    },
    include,
  });
  await recordAudit(actor, {
    action: 'feedback.submitted',
    entityType: 'Feedback',
    entityId: f.id,
    changes: { category: f.category, departmentId },
  });
  return dto(f, actor, false);
}

export async function listFeedback(
  actor: ActorContext,
  q: z.output<typeof feedbackListQuerySchema>,
  box: 'mine' | 'manage',
) {
  if (box === 'manage' && !isManager(actor, PERMISSION)) throw new ForbiddenError();
  const where: Prisma.FeedbackWhereInput = {
    ...(box === 'mine' ? { submittedById: actor.userId } : departmentScope(actor, PERMISSION)),
    ...(q.status ? { status: q.status } : {}),
    ...(q.category ? { category: q.category } : {}),
    ...(q.assignedToMe ? { assigneeId: actor.userId } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.feedback.count({ where }),
    prisma.feedback.findMany({
      where,
      include,
      orderBy: [{ createdAt: 'desc' }],
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
  ]);
  return { total, items: rows.map((f) => dto(f, actor, box === 'manage')) };
}

async function load(actor: ActorContext, id: string) {
  const f = await prisma.feedback.findUnique({ where: { id }, include });
  if (!f) throw new NotFoundError('Feedback');
  const manager = await managesDepartment(actor, PERMISSION, f.departmentId);
  if (!manager && f.submittedById !== actor.userId) throw new NotFoundError('Feedback');
  return { f, manager };
}

export async function getFeedback(actor: ActorContext, id: string) {
  const { f, manager } = await load(actor, id);
  const responses = await prisma.feedbackResponse.findMany({
    where: { feedbackId: id },
    include: { author: person },
    orderBy: { createdAt: 'asc' },
  });
  const view = dto(f, actor, manager);
  return {
    ...view,
    responses: responses.map((r) => ({
      id: r.id,
      body: r.body,
      // Never reveal an anonymous submitter through their own follow-ups.
      author: r.authorId === f.submittedById && !view.submittedBy ? 'Submitter' : name(r.author),
      fromSubmitter: r.authorId === f.submittedById,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

function notice(f: Row, title: string, body: string, portal: string): NewNotification {
  return {
    userId: f.submittedById,
    category: 'FEEDBACK',
    title,
    body: body.slice(0, 300),
    link: `/${portal}/feedback/${f.id}`,
  };
}

export async function updateFeedback(
  actor: ActorContext,
  id: string,
  input: z.output<typeof feedbackUpdateSchema>,
) {
  const { f, manager } = await load(actor, id);
  if (!manager) throw new ForbiddenError();
  if (input.assigneeId) await assertAssignable(input.assigneeId, PERMISSION, f.departmentId);
  const closing = input.status === 'RESOLVED' || input.status === 'CLOSED';
  const reopening = input.status && !closing;
  let after: () => void = () => undefined;
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.feedback.update({
      where: { id },
      data: {
        ...input,
        ...(closing && !f.resolvedAt ? { resolvedAt: new Date() } : {}),
        ...(reopening ? { resolvedAt: null } : {}),
      },
      include,
    });
    const owner = await loadPerson(f.submittedById);
    if (input.status && input.status !== f.status && owner)
      after = await queueNotifications(tx, [
        notice(
          u,
          `Feedback ${input.status === 'RESOLVED' ? 'resolved' : 'updated'}: ${f.subject}`.slice(
            0,
            200,
          ),
          input.status === 'RESOLVED' && u.resolutionNote
            ? u.resolutionNote
            : `Status is now ${input.status.replace(/_/g, ' ').toLowerCase()}.`,
          portalOf(owner),
        ),
      ]);
    if (
      input.assigneeId &&
      input.assigneeId !== f.assigneeId &&
      input.assigneeId !== actor.userId
    ) {
      const prev = after;
      const next = await queueNotifications(tx, [
        {
          userId: input.assigneeId,
          category: 'FEEDBACK',
          title: `Feedback assigned to you: ${f.subject}`.slice(0, 200),
          body: f.description.slice(0, 300),
          link: `/admin/feedback/${f.id}`,
        },
      ]);
      after = () => {
        prev();
        next();
      };
    }
    await recordAudit(
      actor,
      { action: 'feedback.updated', entityType: 'Feedback', entityId: id, changes: input as never },
      tx,
    );
    return u;
  });
  after();
  return dto(updated, actor, true);
}

/** Managers respond to the submitter; submitters may add follow-ups while the case is open. */
export async function respondToFeedback(actor: ActorContext, id: string, body: string) {
  const { f } = await load(actor, id);
  const fromSubmitter = f.submittedById === actor.userId;
  if (fromSubmitter && f.status === 'CLOSED')
    throw new BusinessRuleError(ErrorCode.INVALID_STATE_TRANSITION, 'This feedback is closed');
  let after: () => void = () => undefined;
  await prisma.$transaction(async (tx) => {
    await tx.feedbackResponse.create({ data: { feedbackId: id, authorId: actor.userId, body } });
    await tx.feedback.update({ where: { id }, data: { updatedAt: new Date() } });
    if (!fromSubmitter) {
      const owner = await loadPerson(f.submittedById);
      if (owner)
        after = await queueNotifications(tx, [
          notice(f, `Response to your feedback: ${f.subject}`.slice(0, 200), body, portalOf(owner)),
        ]);
    } else if (f.assigneeId) {
      after = await queueNotifications(tx, [
        {
          userId: f.assigneeId,
          category: 'FEEDBACK',
          title: `Follow-up on feedback: ${f.subject}`.slice(0, 200),
          body: body.slice(0, 300),
          link: `/admin/feedback/${f.id}`,
        },
      ]);
    }
  });
  after();
  return getFeedback(actor, id);
}
