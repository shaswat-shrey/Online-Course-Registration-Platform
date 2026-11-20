import type { ActorContext } from '../../common/context/actor.js';
import { NotFoundError } from '../../common/exceptions/app-error.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { getSocketEmitter, userRoom } from '../../infrastructure/sockets/socket-emitter.js';
import { covers, scopeFilter } from '../authz/authz.js';
import { canInSection, sectionAccess } from '../teaching/teaching-access.js';
import { CURRENT_SESSION, departmentOf, loadPerson, RUNNING_SECTION } from './people.js';

/** Seat holders who stay members of a section conversation (history remains readable). */
const MEMBER_STATUSES = ['REGISTERED', 'PENDING', 'COMPLETED'] as const;

/** Best-effort real-time delivery; the database stays the source of truth. */
export function emitTo(userIds: Iterable<string>, event: string, payload: unknown) {
  try {
    const emitter = getSocketEmitter();
    for (const id of new Set(userIds)) emitter.to(userRoom(id)).emit(event, payload);
  } catch (err) {
    logger.warn({ err, event }, 'Failed to emit socket event');
  }
}

/**
 * Creates the section's conversation if needed and makes its participants match
 * the roster: instructors as moderators, seat-holding students as members
 * (FR-COMM-003). Runs whenever the conversation is opened or posted to.
 */
export async function syncSectionConversation(sectionId: string, actorId: string) {
  const [instructors, students] = await Promise.all([
    prisma.sectionInstructor.findMany({
      where: { sectionId },
      select: { facultyMember: { select: { userId: true } } },
    }),
    prisma.courseRegistration.findMany({
      where: { sectionId, status: { in: [...MEMBER_STATUSES] } },
      select: { student: { select: { userId: true } } },
    }),
  ]);
  const roster = new Map<string, 'MODERATOR' | 'MEMBER'>();
  for (const s of students) roster.set(s.student.userId, 'MEMBER');
  for (const i of instructors) roster.set(i.facultyMember.userId, 'MODERATOR');

  const conversation = await prisma.conversation.upsert({
    where: { sectionId },
    create: { type: 'SECTION', sectionId, createdById: actorId },
    update: {},
    include: { participants: true },
  });
  const now = new Date();
  const current = new Map(conversation.participants.map((p) => [p.userId, p]));
  const toCreate = [...roster].filter(([userId]) => !current.has(userId));
  const toRejoin = [...roster].filter(([userId, role]) => {
    const p = current.get(userId);
    return p && (p.leftAt || p.role !== role);
  });
  const toLeave = conversation.participants.filter((p) => !p.leftAt && !roster.has(p.userId));
  if (toCreate.length || toRejoin.length || toLeave.length)
    await prisma.$transaction([
      prisma.conversationParticipant.createMany({
        data: toCreate.map(([userId, role]) => ({
          conversationId: conversation.id,
          userId,
          role,
          lastReadAt: now,
        })),
        skipDuplicates: true,
      }),
      ...toRejoin.map(([userId, role]) =>
        prisma.conversationParticipant.update({
          where: { conversationId_userId: { conversationId: conversation.id, userId } },
          data: { role, leftAt: null },
        }),
      ),
      prisma.conversationParticipant.updateMany({
        where: { conversationId: conversation.id, userId: { in: toLeave.map((p) => p.userId) } },
        data: { leftAt: now },
      }),
    ]);
  return conversation.id;
}

/**
 * Makes sure the user is in the conversations of their running sections, and
 * out of those of sections they no longer belong to.
 */
export async function syncMySectionConversations(userId: string) {
  const [taught, held] = await Promise.all([
    prisma.sectionInstructor.findMany({
      where: { facultyMember: { userId } },
      select: { sectionId: true, section: { select: { status: true, session: true } } },
    }),
    prisma.courseRegistration.findMany({
      where: { student: { userId }, status: { in: [...MEMBER_STATUSES] } },
      select: { sectionId: true, section: { select: { status: true, session: true } } },
    }),
  ]);
  const roles = new Map<string, 'MODERATOR' | 'MEMBER'>();
  for (const h of held) roles.set(h.sectionId, 'MEMBER');
  for (const t of taught) roles.set(t.sectionId, 'MODERATOR');
  const running = new Set(
    [...taught, ...held]
      .filter(
        (x) =>
          (RUNNING_SECTION.in as string[]).includes(x.section.status) &&
          (CURRENT_SESSION.status.in as string[]).includes(x.section.session.status),
      )
      .map((x) => x.sectionId),
  );

  const memberships = await prisma.conversationParticipant.findMany({
    where: { userId, conversation: { type: 'SECTION' } },
    select: { conversationId: true, leftAt: true, conversation: { select: { sectionId: true } } },
  });
  const bySection = new Map(memberships.map((m) => [m.conversation.sectionId!, m]));
  const now = new Date();
  const stale = memberships.filter((m) => !m.leftAt && !roles.has(m.conversation.sectionId!));
  if (stale.length)
    await prisma.conversationParticipant.updateMany({
      where: { userId, conversationId: { in: stale.map((m) => m.conversationId) } },
      data: { leftAt: now },
    });

  for (const sectionId of running) {
    const m = bySection.get(sectionId);
    if (m && !m.leftAt) continue;
    const conversation = await prisma.conversation.upsert({
      where: { sectionId },
      create: { type: 'SECTION', sectionId, createdById: userId },
      update: {},
      select: { id: true },
    });
    await prisma.conversationParticipant.upsert({
      where: { conversationId_userId: { conversationId: conversation.id, userId } },
      create: {
        conversationId: conversation.id,
        userId,
        role: roles.get(sectionId)!,
        lastReadAt: now,
      },
      update: { leftAt: null, role: roles.get(sectionId)! },
    });
  }
}

/** Administrators answering the support inbox: `message:moderate` beyond relationship scope. */
export function supportScope(actor: ActorContext) {
  const grants = actor.grants['message:moderate'] ?? [];
  if (!grants.some((g) => g.scope !== 'OWN')) return undefined;
  return scopeFilter(actor.grants, 'message:moderate');
}

/** Prisma filter on the support owner's department for a scoped administrator. */
export function supportOwnerFilter(scope: { schoolIds: string[]; departmentIds: string[] }) {
  const dept = {
    OR: [
      { departmentId: { in: scope.departmentIds } },
      { department: { schoolId: { in: scope.schoolIds } } },
    ],
  };
  return {
    OR: [{ student: { program: dept } }, { facultyMember: dept }],
  };
}

export type ConversationAccess = Awaited<ReturnType<typeof conversationAccess>>;

/**
 * Who the caller is to a conversation: an active participant, a moderator
 * (section instructors and covering administrators; support staff), or nobody
 * (404, so conversation ids are not probeable).
 */
export async function conversationAccess(actor: ActorContext, conversationId: string) {
  let conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) throw new NotFoundError('Conversation');
  let moderator = false;
  if (conversation.type === 'SECTION') {
    await syncSectionConversation(conversation.sectionId!, actor.userId);
    const access = await sectionAccess(actor, conversation.sectionId!);
    moderator = canInSection(actor, access, 'message:moderate');
    conversation = (await prisma.conversation.findUnique({ where: { id: conversationId } }))!;
  }
  if (conversation.type === 'SUPPORT' && conversation.supportOwnerId !== actor.userId) {
    const scope = supportScope(actor);
    if (scope !== undefined) {
      if (scope === null) moderator = true;
      else {
        const owner = await loadPerson(conversation.supportOwnerId!);
        const dept = owner ? departmentOf(owner) : null;
        moderator = !!dept && covers(actor.grants, 'message:moderate', dept);
      }
    }
  }
  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId: actor.userId } },
  });
  const member = !!participant && !participant.leftAt;
  if (!member && !moderator) throw new NotFoundError('Conversation');
  return { conversation, participant: member ? participant : null, moderator };
}
