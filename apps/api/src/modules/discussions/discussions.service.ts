import {
  ErrorCode,
  type postCreateSchema,
  type threadCreateSchema,
  type threadUpdateSchema,
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
import { loadPeople, portalOf } from '../messaging/people.js';
import { queueNotifications } from '../notifications/notifications.service.js';
import { canInSection, isSectionStudent, sectionAccess } from '../teaching/teaching-access.js';

/**
 * Section discussions (FR-COMM-007): instructors, covering administrators and
 * students holding (or having held) a seat may read and post; instructors and
 * covering administrators moderate (pin, lock, mark answers, remove posts).
 */
async function boardAccess(actor: ActorContext, sectionId: string) {
  const access = await sectionAccess(actor, sectionId);
  const moderator = canInSection(actor, access, 'message:moderate');
  const staff = moderator || canInSection(actor, access, 'roster:read');
  if (!staff && !(await isSectionStudent(actor, sectionId))) throw new NotFoundError('Section');
  return { access, moderator };
}

const author = { select: { id: true, firstName: true, lastName: true } } as const;
const threadInclude = { author } satisfies Prisma.DiscussionThreadInclude;
type ThreadRow = Prisma.DiscussionThreadGetPayload<{ include: typeof threadInclude }>;
type PostRow = Prisma.DiscussionPostGetPayload<{ include: { author: typeof author } }>;

function threadDto(t: ThreadRow, actor: ActorContext, moderator: boolean) {
  const deleted = !!t.deletedAt;
  return {
    id: t.id,
    sectionId: t.sectionId,
    type: t.type,
    title: deleted ? 'Removed thread' : t.title,
    body: deleted ? null : t.body,
    deleted,
    pinned: t.pinned,
    locked: t.locked,
    answered: !!t.answerPostId,
    answerPostId: t.answerPostId,
    replyCount: t.replyCount,
    author: { id: t.author.id, name: `${t.author.firstName} ${t.author.lastName}` },
    mine: t.authorId === actor.userId,
    canEdit: !deleted && t.authorId === actor.userId && !t.locked,
    canDelete: !deleted && (t.authorId === actor.userId || moderator),
    lastActivityAt: t.lastActivityAt.toISOString(),
    editedAt: t.editedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}

function postDto(p: PostRow, actor: ActorContext, moderator: boolean, answerPostId: string | null) {
  const deleted = !!p.deletedAt;
  return {
    id: p.id,
    body: deleted ? null : p.body,
    deleted,
    isAnswer: p.id === answerPostId,
    author: { id: p.author.id, name: `${p.author.firstName} ${p.author.lastName}` },
    mine: p.authorId === actor.userId,
    canDelete: !deleted && (p.authorId === actor.userId || moderator),
    editedAt: p.editedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function listThreads(
  actor: ActorContext,
  sectionId: string,
  q: { q?: string; type?: 'QUESTION' | 'DISCUSSION'; unanswered?: boolean },
) {
  const { moderator, access } = await boardAccess(actor, sectionId);
  const rows = await prisma.discussionThread.findMany({
    where: {
      sectionId,
      deletedAt: null,
      ...(q.type ? { type: q.type } : {}),
      ...(q.unanswered ? { type: 'QUESTION', answerPostId: null } : {}),
      ...(q.q
        ? {
            OR: [
              { title: { contains: q.q, mode: 'insensitive' } },
              { body: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: threadInclude,
    orderBy: [{ pinned: 'desc' }, { lastActivityAt: 'desc' }],
    take: 200,
  });
  return {
    section: {
      id: access.section.id,
      label: `${access.section.course.code} ${access.section.sectionCode}`,
      title: access.section.course.title,
    },
    canModerate: moderator,
    items: rows.map((t) => threadDto(t, actor, moderator)),
  };
}

export async function createThread(
  actor: ActorContext,
  sectionId: string,
  input: z.output<typeof threadCreateSchema>,
) {
  const { moderator } = await boardAccess(actor, sectionId);
  const t = await prisma.discussionThread.create({
    data: { sectionId, authorId: actor.userId, ...input },
    include: threadInclude,
  });
  return threadDto(t, actor, moderator);
}

async function loadThread(actor: ActorContext, threadId: string) {
  const t = await prisma.discussionThread.findUnique({
    where: { id: threadId },
    include: threadInclude,
  });
  if (!t) throw new NotFoundError('Thread');
  const { moderator } = await boardAccess(actor, t.sectionId);
  if (t.deletedAt && !moderator) throw new NotFoundError('Thread');
  return { t, moderator };
}

export async function getThread(actor: ActorContext, threadId: string) {
  const { t, moderator } = await loadThread(actor, threadId);
  const posts = await prisma.discussionPost.findMany({
    where: { threadId },
    include: { author },
    orderBy: { createdAt: 'asc' },
  });
  return {
    ...threadDto(t, actor, moderator),
    canModerate: moderator,
    canReply: !t.locked && !t.deletedAt,
    posts: posts.map((p) => postDto(p, actor, moderator, t.answerPostId)),
  };
}

export async function updateThread(
  actor: ActorContext,
  threadId: string,
  input: z.output<typeof threadUpdateSchema>,
) {
  const { t, moderator } = await loadThread(actor, threadId);
  const { title, body, pinned, locked, answerPostId } = input;
  if ((pinned !== undefined || locked !== undefined || answerPostId !== undefined) && !moderator)
    throw new ForbiddenError('Only instructors can pin, lock or mark answers');
  if ((title !== undefined || body !== undefined) && t.authorId !== actor.userId)
    throw new ForbiddenError('You can only edit your own thread');
  if ((title !== undefined || body !== undefined) && t.locked)
    throw new BusinessRuleError(ErrorCode.THREAD_LOCKED, 'This thread is locked');
  if (answerPostId) {
    if (t.type !== 'QUESTION')
      throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Only questions have answers');
    const post = await prisma.discussionPost.findFirst({
      where: { id: answerPostId, threadId, deletedAt: null },
    });
    if (!post)
      throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Choose a reply in this thread', {
        fields: [{ path: 'body.answerPostId', message: 'Unknown reply' }],
      });
  }
  await prisma.discussionThread.update({
    where: { id: threadId },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(title !== undefined || body !== undefined ? { editedAt: new Date() } : {}),
      ...(pinned !== undefined ? { pinned } : {}),
      ...(locked !== undefined ? { locked } : {}),
      ...(answerPostId !== undefined ? { answerPostId } : {}),
    },
  });
  if (answerPostId && answerPostId !== t.answerPostId) {
    const post = await prisma.discussionPost.findUniqueOrThrow({ where: { id: answerPostId } });
    if (post.authorId !== actor.userId) {
      const person = (await loadPeople([post.authorId])).get(post.authorId);
      const after = await queueNotifications(prisma, [
        {
          userId: post.authorId,
          category: 'MESSAGE',
          title: 'Your reply was marked as the answer',
          body: t.title,
          link: `/${person ? portalOf(person) : 'student'}/discussions/${threadId}`,
        },
      ]);
      after();
    }
  }
  return getThread(actor, threadId);
}

export async function deleteThread(actor: ActorContext, threadId: string) {
  const { t, moderator } = await loadThread(actor, threadId);
  if (t.authorId !== actor.userId && !moderator) throw new ForbiddenError();
  await prisma.discussionThread.update({
    where: { id: threadId },
    data: { deletedAt: new Date() },
  });
}

/** Replies notify the thread author (unless they wrote the reply). */
export async function createPost(
  actor: ActorContext,
  threadId: string,
  input: z.output<typeof postCreateSchema>,
) {
  const { t, moderator } = await loadThread(actor, threadId);
  if (t.deletedAt) throw new NotFoundError('Thread');
  if (t.locked) throw new BusinessRuleError(ErrorCode.THREAD_LOCKED, 'This thread is locked');
  let after: () => void = () => undefined;
  const post = await prisma.$transaction(async (tx) => {
    const p = await tx.discussionPost.create({
      data: { threadId, authorId: actor.userId, body: input.body },
      include: { author },
    });
    await tx.discussionThread.update({
      where: { id: threadId },
      data: { replyCount: { increment: 1 }, lastActivityAt: p.createdAt },
    });
    if (t.authorId !== actor.userId) {
      const person = (await loadPeople([t.authorId])).get(t.authorId);
      after = await queueNotifications(tx, [
        {
          userId: t.authorId,
          category: 'MESSAGE',
          title: `New reply: ${t.title}`.slice(0, 200),
          body: `${p.author.firstName} ${p.author.lastName}: ${input.body.slice(0, 250)}`,
          link: `/${person ? portalOf(person) : 'student'}/discussions/${threadId}`,
        },
      ]);
    }
    return p;
  });
  after();
  return postDto(post, actor, moderator, t.answerPostId);
}

export async function deletePost(actor: ActorContext, postId: string) {
  const p = await prisma.discussionPost.findUnique({ where: { id: postId } });
  if (!p) throw new NotFoundError('Reply');
  const { moderator } = await loadThread(actor, p.threadId);
  if (p.authorId !== actor.userId && !moderator) throw new ForbiddenError();
  if (p.deletedAt) return;
  await prisma.$transaction([
    prisma.discussionPost.update({ where: { id: postId }, data: { deletedAt: new Date() } }),
    prisma.discussionThread.update({
      where: { id: p.threadId },
      data: { replyCount: { decrement: 1 } },
    }),
    prisma.discussionThread.updateMany({
      where: { id: p.threadId, answerPostId: postId },
      data: { answerPostId: null },
    }),
  ]);
}

/** Sections whose boards the caller can open: taught sections and seats held, current sessions first. */
export async function myBoards(actor: ActorContext) {
  const sections = await prisma.courseSection.findMany({
    where: {
      status: { in: ['PUBLISHED', 'CLOSED', 'COMPLETED'] },
      OR: [
        { instructors: { some: { facultyMember: { userId: actor.userId } } } },
        {
          registrations: {
            some: {
              status: { in: ['REGISTERED', 'PENDING', 'COMPLETED'] },
              student: { userId: actor.userId },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      sectionCode: true,
      course: { select: { code: true, title: true } },
      session: { select: { name: true, status: true, startDate: true } },
      _count: { select: { discussionThreads: { where: { deletedAt: null } } } },
    },
    orderBy: [{ session: { startDate: 'desc' } }],
    take: 100,
  });
  return sections.map((s) => ({
    id: s.id,
    label: `${s.course.code} ${s.sectionCode}`,
    title: s.course.title,
    session: s.session.name,
    current: s.session.status === 'ACTIVE' || s.session.status === 'PLANNED',
    threads: s._count.discussionThreads,
  }));
}
