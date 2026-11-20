import { ErrorCode } from '@ucrams/shared';
import type { z } from 'zod';
import type { announcementCreateSchema, announcementUpdateSchema } from '@ucrams/shared';
import type { ActorContext } from '../../common/context/actor.js';
import { BusinessRuleError, NotFoundError } from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import {
  queueNotifications,
  type NewNotification,
} from '../notifications/notifications.service.js';
import {
  assertInSection,
  canInSection,
  isSectionStudent,
  sectionAccess,
} from './teaching-access.js';

const include = {
  author: { select: { firstName: true, lastName: true } },
  audiences: true,
} as const;

async function sectionLabels(ids: string[]) {
  const rows = await prisma.courseSection.findMany({
    where: { id: { in: ids } },
    select: { id: true, sectionCode: true, course: { select: { code: true } } },
  });
  return new Map(rows.map((r) => [r.id, `${r.course.code} ${r.sectionCode}`]));
}

async function toDtos(
  rows: Array<{
    id: string;
    authorId: string;
    title: string;
    body: string;
    priority: string;
    pinned: boolean;
    publishedAt: Date;
    expiresAt: Date | null;
    author: { firstName: string; lastName: string };
    audiences: Array<{ targetId: string }>;
  }>,
  actor: ActorContext,
) {
  const labels = await sectionLabels([
    ...new Set(rows.flatMap((r) => r.audiences.map((a) => a.targetId))),
  ]);
  return rows.map((a) => ({
    id: a.id,
    title: a.title,
    body: a.body,
    priority: a.priority,
    pinned: a.pinned,
    publishedAt: a.publishedAt.toISOString(),
    expiresAt: a.expiresAt?.toISOString() ?? null,
    author: `${a.author.firstName} ${a.author.lastName}`,
    mine: a.authorId === actor.userId,
    sections: a.audiences.map((x) => ({
      id: x.targetId,
      label: labels.get(x.targetId) ?? 'Section',
    })),
  }));
}

/**
 * Publishes to one or several sections the author teaches (FR-FACULTY-008/011);
 * enrolled students and fellow instructors are notified.
 */
export async function createAnnouncement(
  actor: ActorContext,
  input: z.output<typeof announcementCreateSchema>,
) {
  const accesses = await Promise.all(input.sectionIds.map((id) => sectionAccess(actor, id)));
  for (const a of accesses) {
    assertInSection(actor, a, 'announcement:publish_section');
    if (a.section.status === 'CANCELLED' || a.section.status === 'DRAFT')
      throw new BusinessRuleError(
        ErrorCode.VALIDATION_ERROR,
        `${a.section.course.code} ${a.section.sectionCode} is not running`,
        {
          fields: [{ path: 'body.sectionIds', message: 'Only published or closed sections' }],
        },
      );
  }
  let after: () => void = () => undefined;
  const created = await prisma.$transaction(async (tx) => {
    const a = await tx.announcement.create({
      data: {
        authorId: actor.userId,
        title: input.title,
        body: input.body,
        priority: input.priority,
        pinned: input.pinned,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        audiences: {
          create: input.sectionIds.map((targetId) => ({
            targetType: 'SECTION' as const,
            targetId,
          })),
        },
      },
      include,
    });
    const [students, instructors] = await Promise.all([
      tx.courseRegistration.findMany({
        where: { sectionId: { in: input.sectionIds }, status: { in: ['REGISTERED', 'PENDING'] } },
        select: { student: { select: { userId: true } } },
      }),
      tx.sectionInstructor.findMany({
        where: { sectionId: { in: input.sectionIds } },
        select: { facultyMember: { select: { userId: true } } },
      }),
    ]);
    const labels = accesses
      .map((x) => `${x.section.course.code} ${x.section.sectionCode}`)
      .join(', ');
    const recipients = new Set([
      ...students.map((s) => s.student.userId),
      ...instructors.map((i) => i.facultyMember.userId),
    ]);
    recipients.delete(actor.userId);
    const studentIds = new Set(students.map((s) => s.student.userId));
    const notices: NewNotification[] = [...recipients].map((userId) => ({
      userId,
      category: 'ANNOUNCEMENT',
      title: `${input.priority === 'URGENT' ? 'Urgent: ' : ''}${input.title}`,
      body: `${labels}: ${input.body.slice(0, 300)}`,
      link: studentIds.has(userId) ? '/student/announcements' : null,
    }));
    after = await queueNotifications(tx, notices);
    await recordAudit(
      actor,
      {
        action: 'announcement.published',
        entityType: 'Announcement',
        entityId: a.id,
        changes: { sectionIds: input.sectionIds, recipients: notices.length },
      },
      tx,
    );
    return a;
  });
  after();
  return (await toDtos([created], actor))[0]!;
}

/** Announcements of a section for its instructors, administrators and students (current ones only for students). */
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
      ...(staff
        ? {}
        : { publishedAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }),
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

export async function myAnnouncements(actor: ActorContext) {
  const rows = await prisma.announcement.findMany({
    where: { authorId: actor.userId },
    include,
    orderBy: { publishedAt: 'desc' },
    take: 100,
  });
  return toDtos(rows, actor);
}

async function ownAnnouncement(actor: ActorContext, id: string) {
  const a = await prisma.announcement.findUnique({ where: { id } });
  if (!a || a.authorId !== actor.userId) throw new NotFoundError('Announcement');
  return a;
}

export async function updateAnnouncement(
  actor: ActorContext,
  id: string,
  input: z.output<typeof announcementUpdateSchema>,
) {
  await ownAnnouncement(actor, id);
  const a = await prisma.announcement.update({ where: { id }, data: input, include });
  await recordAudit(actor, {
    action: 'announcement.updated',
    entityType: 'Announcement',
    entityId: id,
    changes: input as never,
  });
  return (await toDtos([a], actor))[0]!;
}

export async function deleteAnnouncement(actor: ActorContext, id: string) {
  await ownAnnouncement(actor, id);
  await prisma.announcement.delete({ where: { id } });
  await recordAudit(actor, {
    action: 'announcement.deleted',
    entityType: 'Announcement',
    entityId: id,
  });
}
