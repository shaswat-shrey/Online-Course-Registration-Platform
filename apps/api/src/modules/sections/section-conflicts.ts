import { meetingsOverlap } from '@ucrams/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import type { prisma } from '../../infrastructure/database/prisma.js';

type Db = Pick<typeof prisma, 'sectionMeeting'> | Prisma.TransactionClient;

export interface MeetingSlot {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  classroomId?: string | null;
}

export interface Conflict {
  kind: 'CLASSROOM' | 'INSTRUCTOR';
  /** Classroom label or instructor name. */
  resource: string;
  resourceId: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  section: { id: string; sectionCode: string; courseCode: string };
}

const otherSection = {
  select: {
    id: true,
    sectionCode: true,
    course: { select: { code: true } },
    instructors: {
      select: {
        facultyMemberId: true,
        facultyMember: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
    },
  },
} as const;

/**
 * Classroom and instructor clashes of `meetings` with other non-cancelled
 * sections of the same session (FR-CRS-007/008, BR-018).
 */
export async function findConflicts(
  db: Db,
  args: {
    sessionId: string;
    sectionId: string | null;
    meetings: MeetingSlot[];
    instructorIds: string[];
  },
): Promise<Conflict[]> {
  const { sessionId, sectionId, meetings, instructorIds } = args;
  if (!meetings.length) return [];
  const days = [...new Set(meetings.map((m) => m.dayOfWeek))];
  const roomIds = [...new Set(meetings.flatMap((m) => (m.classroomId ? [m.classroomId] : [])))];
  const sectionFilter = {
    sessionId,
    status: { not: 'CANCELLED' as const },
    ...(sectionId ? { id: { not: sectionId } } : {}),
  };
  const or: Prisma.SectionMeetingWhereInput[] = [];
  if (roomIds.length) or.push({ classroomId: { in: roomIds } });
  if (instructorIds.length)
    or.push({ section: { instructors: { some: { facultyMemberId: { in: instructorIds } } } } });
  if (!or.length) return [];
  const candidates = await db.sectionMeeting.findMany({
    where: { dayOfWeek: { in: days }, section: sectionFilter, OR: or },
    include: {
      section: otherSection,
      classroom: { select: { id: true, building: true, roomNumber: true } },
    },
  });
  const conflicts: Conflict[] = [];
  for (const mine of meetings) {
    for (const other of candidates) {
      if (!meetingsOverlap(mine, other)) continue;
      const where = {
        dayOfWeek: other.dayOfWeek,
        startMinute: other.startMinute,
        endMinute: other.endMinute,
        section: {
          id: other.section.id,
          sectionCode: other.section.sectionCode,
          courseCode: other.section.course.code,
        },
      };
      if (mine.classroomId && other.classroomId === mine.classroomId && other.classroom) {
        conflicts.push({
          kind: 'CLASSROOM',
          resource: `${other.classroom.building} ${other.classroom.roomNumber}`,
          resourceId: other.classroom.id,
          ...where,
        });
      }
      for (const i of other.section.instructors) {
        if (!instructorIds.includes(i.facultyMemberId)) continue;
        conflicts.push({
          kind: 'INSTRUCTOR',
          resource: `${i.facultyMember.user.firstName} ${i.facultyMember.user.lastName}`,
          resourceId: i.facultyMemberId,
          ...where,
        });
      }
    }
  }
  // One entry per (kind, resource, other section, slot).
  const seen = new Set<string>();
  return conflicts.filter((c) => {
    const key = `${c.kind}:${c.resourceId}:${c.section.id}:${c.dayOfWeek}:${c.startMinute}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Serialises schedule writes within a session so concurrent edits cannot double-book. */
export async function lockSessionSchedule(tx: Prisma.TransactionClient, sessionId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`schedule:${sessionId}`}))`;
}
