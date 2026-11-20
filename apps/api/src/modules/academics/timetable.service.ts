import { prisma } from '../../infrastructure/database/prisma.js';

/** Teaching day used for the free/busy totals (08:00–20:00, Monday–Saturday). */
const DAY_MINUTES = 12 * 60;
const TEACHING_DAYS = 6;

/**
 * Classroom free/busy for a session (FR-ACAD-002): every active room matching
 * the filters with its booked meetings, from the same section meetings that
 * build every other timetable (FR-ACAD-001).
 */
export async function classroomAvailability(q: {
  sessionId: string;
  campusId?: string;
  minCapacity?: number;
  type?: string;
}) {
  const rooms = await prisma.classroom.findMany({
    where: {
      status: 'ACTIVE',
      ...(q.campusId ? { campusId: q.campusId } : {}),
      ...(q.minCapacity ? { capacity: { gte: q.minCapacity } } : {}),
      ...(q.type ? { type: q.type as never } : {}),
    },
    include: {
      campus: { select: { code: true } },
      meetings: {
        where: { section: { sessionId: q.sessionId, status: { not: 'CANCELLED' } } },
        select: {
          dayOfWeek: true,
          startMinute: true,
          endMinute: true,
          section: { select: { id: true, sectionCode: true, course: { select: { code: true } } } },
        },
        orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
      },
    },
    orderBy: [{ building: 'asc' }, { roomNumber: 'asc' }],
  });
  return rooms.map((c) => {
    const busyMinutes = c.meetings.reduce((s, m) => s + (m.endMinute - m.startMinute), 0);
    return {
      id: c.id,
      label: `${c.building} ${c.roomNumber}${c.name ? ` (${c.name})` : ''}`,
      campus: c.campus.code,
      capacity: c.capacity,
      type: c.type,
      utilization: Math.round((busyMinutes / (DAY_MINUTES * TEACHING_DAYS)) * 1000) / 10,
      busy: c.meetings.map((m) => ({
        dayOfWeek: m.dayOfWeek,
        startMinute: m.startMinute,
        endMinute: m.endMinute,
        sectionId: m.section.id,
        label: `${m.section.course.code} ${m.section.sectionCode}`,
      })),
    };
  });
}
