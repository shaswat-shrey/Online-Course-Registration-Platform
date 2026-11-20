import type { z } from 'zod';
import { ErrorCode, type classroomCreateSchema, type classroomUpdateSchema } from '@ucrams/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext } from '../../common/context/actor.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../common/exceptions/app-error.js';
import { paging, toOrderBy } from '../../common/http/list-query.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { diffChanges, recordAudit } from '../audit/audit.service.js';
import { assertGlobal } from '../authz/authz.js';
import { hasDependents } from '../structure-scope.js';

const include = {
  campus: { select: { id: true, code: true, name: true } },
  _count: { select: { meetings: true } },
} as const;
type Row = Prisma.ClassroomGetPayload<{ include: typeof include }>;

function toDto(c: Row) {
  return {
    id: c.id,
    campus: c.campus,
    building: c.building,
    roomNumber: c.roomNumber,
    name: c.name,
    label: `${c.building} ${c.roomNumber}${c.name ? ` (${c.name})` : ''}`,
    capacity: c.capacity,
    type: c.type,
    equipment: c.equipment,
    status: c.status,
    meetingCount: c._count.meetings,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function listClassrooms(q: {
  page: number;
  limit: number;
  q?: string;
  status?: string;
  campusId?: string;
  type?: string;
  minCapacity?: number;
  sort: { field: 'building' | 'capacity' | 'createdAt'; direction: 'asc' | 'desc' }[];
}) {
  const where: Prisma.ClassroomWhereInput = {
    ...(q.q
      ? {
          OR: [
            { building: { contains: q.q, mode: 'insensitive' } },
            { roomNumber: { contains: q.q, mode: 'insensitive' } },
            { name: { contains: q.q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(q.status ? { status: q.status as never } : {}),
    ...(q.campusId ? { campusId: q.campusId } : {}),
    ...(q.type ? { type: q.type as never } : {}),
    ...(q.minCapacity ? { capacity: { gte: q.minCapacity } } : {}),
  };
  const orderBy = [...toOrderBy(q.sort), { roomNumber: 'asc' as const }];
  const [total, rows] = await Promise.all([
    prisma.classroom.count({ where }),
    prisma.classroom.findMany({ where, include, orderBy, ...paging(q) }),
  ]);
  return { total, items: rows.map(toDto) };
}

export async function getClassroom(id: string) {
  const row = await prisma.classroom.findUnique({ where: { id }, include });
  if (!row) throw new NotFoundError('Classroom');
  return toDto(row);
}

async function assertCampus(campusId: string) {
  const campus = await prisma.campus.findUnique({ where: { id: campusId } });
  if (!campus || campus.status !== 'ACTIVE') {
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Choose an active campus', {
      fields: [{ path: 'body.campusId', message: 'Choose an active campus' }],
    });
  }
}

async function assertRoomFree(
  campusId: string,
  building: string,
  roomNumber: string,
  exceptId?: string,
) {
  const clash = await prisma.classroom.findFirst({
    where: {
      campusId,
      building: { equals: building, mode: 'insensitive' },
      roomNumber: { equals: roomNumber, mode: 'insensitive' },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
  });
  if (clash) {
    throw new ConflictError(ErrorCode.UNIQUE_VIOLATION, 'This room already exists on the campus', {
      fields: [{ path: 'body.roomNumber', message: 'Already exists in this building' }],
    });
  }
}

export async function createClassroom(
  actor: ActorContext,
  input: z.output<typeof classroomCreateSchema>,
) {
  assertGlobal(actor, 'classroom:manage');
  await assertCampus(input.campusId);
  await assertRoomFree(input.campusId, input.building, input.roomNumber);
  return prisma.$transaction(async (tx) => {
    const row = await tx.classroom.create({ data: input, include });
    await recordAudit(
      actor,
      { action: 'classroom.created', entityType: 'Classroom', entityId: row.id, changes: input },
      tx,
    );
    return toDto(row);
  });
}

export async function updateClassroom(
  actor: ActorContext,
  id: string,
  input: z.output<typeof classroomUpdateSchema>,
) {
  assertGlobal(actor, 'classroom:manage');
  const before = await prisma.classroom.findUnique({ where: { id } });
  if (!before) throw new NotFoundError('Classroom');
  if (input.campusId && input.campusId !== before.campusId) await assertCampus(input.campusId);
  const campusId = input.campusId ?? before.campusId;
  const building = input.building ?? before.building;
  const roomNumber = input.roomNumber ?? before.roomNumber;
  if (input.campusId || input.building || input.roomNumber)
    await assertRoomFree(campusId, building, roomNumber, id);
  if (input.status && input.status !== 'ACTIVE' && before.status === 'ACTIVE') {
    const upcoming = await prisma.sectionMeeting.count({
      where: {
        classroomId: id,
        section: {
          status: { in: ['DRAFT', 'PUBLISHED', 'CLOSED'] },
          session: { status: { in: ['PLANNED', 'ACTIVE'] } },
        },
      },
    });
    if (upcoming > 0)
      throw hasDependents('Move the meetings scheduled in this room first', {
        scheduledMeetings: upcoming,
      });
  }
  return prisma.$transaction(async (tx) => {
    const row = await tx.classroom.update({ where: { id }, data: input, include });
    await recordAudit(
      actor,
      {
        action: 'classroom.updated',
        entityType: 'Classroom',
        entityId: id,
        changes: diffChanges(before, row) as never,
      },
      tx,
    );
    return toDto(row);
  });
}

export async function deleteClassroom(actor: ActorContext, id: string) {
  assertGlobal(actor, 'classroom:manage');
  const row = await prisma.classroom.findUnique({ where: { id }, include });
  if (!row) throw new NotFoundError('Classroom');
  if (row._count.meetings > 0)
    throw hasDependents('This room has scheduled meetings; deactivate it instead', {
      meetings: row._count.meetings,
    });
  await prisma.$transaction(async (tx) => {
    await tx.classroom.delete({ where: { id } });
    await recordAudit(
      actor,
      {
        action: 'classroom.deleted',
        entityType: 'Classroom',
        entityId: id,
        changes: { building: row.building, roomNumber: row.roomNumber },
      },
      tx,
    );
  });
}

/** Weekly occupancy of a room in a session (cancelled sections excluded). */
export async function classroomSchedule(id: string, sessionId: string) {
  if (!(await prisma.classroom.findUnique({ where: { id } }))) throw new NotFoundError('Classroom');
  const meetings = await prisma.sectionMeeting.findMany({
    where: { classroomId: id, section: { sessionId, status: { not: 'CANCELLED' } } },
    include: {
      section: {
        select: {
          id: true,
          sectionCode: true,
          status: true,
          course: { select: { id: true, code: true, title: true } },
        },
      },
    },
    orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
  });
  return meetings.map((m) => ({
    id: m.id,
    dayOfWeek: m.dayOfWeek,
    startMinute: m.startMinute,
    endMinute: m.endMinute,
    type: m.type,
    section: {
      id: m.section.id,
      sectionCode: m.section.sectionCode,
      status: m.section.status,
      course: m.section.course,
    },
  }));
}
