import {
  ErrorCode,
  type attendanceRecordsSchema,
  type attendanceSessionCreateSchema,
} from '@ucrams/shared';
import type { z } from 'zod';
import type { ActorContext } from '../../common/context/actor.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import {
  assertInSection,
  canInSection,
  sectionAccess,
  type SectionAccess,
} from '../teaching/teaching-access.js';

/** Students on the attendance list: those holding (or having completed) a seat. */
export const CLASS_LIST = ['REGISTERED', 'COMPLETED'] as const;

export async function classList(sectionId: string) {
  const regs = await prisma.courseRegistration.findMany({
    where: { sectionId, status: { in: [...CLASS_LIST] } },
    select: {
      id: true,
      status: true,
      credits: true,
      student: {
        select: {
          id: true,
          studentNumber: true,
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
    orderBy: [
      { student: { user: { lastName: 'asc' } } },
      { student: { user: { firstName: 'asc' } } },
    ],
  });
  return regs.map((r) => ({
    registrationId: r.id,
    registrationStatus: r.status,
    credits: r.credits.toNumber(),
    studentId: r.student.id,
    userId: r.student.user.id,
    studentNumber: r.student.studentNumber,
    name: `${r.student.user.firstName} ${r.student.user.lastName}`,
  }));
}

/** Present or late over every marked session except excused ones (FR-ACAD-003). */
export function attendancePercent(statuses: string[]): number | null {
  const counted = statuses.filter((s) => s !== 'EXCUSED');
  if (!counted.length) return null;
  const attended = counted.filter((s) => s === 'PRESENT' || s === 'LATE').length;
  return Math.round((attended / counted.length) * 1000) / 10;
}

/** Attendance % per student id for a section's marked sessions. */
export async function attendanceBySection(sectionId: string) {
  const records = await prisma.attendanceRecord.findMany({
    where: { session: { sectionId } },
    select: { studentId: true, status: true },
  });
  const by = new Map<string, string[]>();
  for (const r of records) by.set(r.studentId, [...(by.get(r.studentId) ?? []), r.status]);
  return new Map([...by].map(([id, statuses]) => [id, attendancePercent(statuses)]));
}

function assertEnabled(access: SectionAccess, enabled: boolean) {
  if (!enabled)
    throw new BusinessRuleError(
      ErrorCode.VALIDATION_ERROR,
      `Attendance is turned off for ${access.section.course.code} ${access.section.sectionCode}`,
    );
}

async function sectionFlags(sectionId: string) {
  return prisma.courseSection.findUniqueOrThrow({
    where: { id: sectionId },
    select: { attendanceEnabled: true },
  });
}

/** The attendance register: sessions (newest first), the class list and every mark. */
export async function register(actor: ActorContext, sectionId: string) {
  const access = await sectionAccess(actor, sectionId);
  const manage = canInSection(actor, access, 'attendance:manage');
  if (!manage) assertInSection(actor, access, 'roster:read');
  const [flags, sessions, students] = await Promise.all([
    sectionFlags(sectionId),
    prisma.attendanceSession.findMany({
      where: { sectionId },
      include: { records: { select: { studentId: true, status: true, note: true } } },
      orderBy: [{ date: 'desc' }, { startMinute: 'desc' }],
    }),
    classList(sectionId),
  ]);
  const perStudent = new Map<string, string[]>();
  for (const s of sessions)
    for (const r of s.records)
      perStudent.set(r.studentId, [...(perStudent.get(r.studentId) ?? []), r.status]);
  return {
    enabled: flags.attendanceEnabled,
    canManage: manage,
    students: students.map((s) => ({
      ...s,
      percent: attendancePercent(perStudent.get(s.studentId) ?? []),
    })),
    sessions: sessions.map((s) => ({
      id: s.id,
      date: s.date.toISOString().slice(0, 10),
      startMinute: s.startMinute,
      topic: s.topic,
      marked: s.records.length,
      records: s.records.map((r) => ({ studentId: r.studentId, status: r.status, note: r.note })),
    })),
  };
}

export async function setAttendanceEnabled(
  actor: ActorContext,
  sectionId: string,
  enabled: boolean,
) {
  const access = await sectionAccess(actor, sectionId);
  assertInSection(actor, access, 'attendance:manage');
  await prisma.courseSection.update({
    where: { id: sectionId },
    data: { attendanceEnabled: enabled },
  });
  return { enabled };
}

export async function createSession(
  actor: ActorContext,
  sectionId: string,
  input: z.output<typeof attendanceSessionCreateSchema>,
) {
  const access = await sectionAccess(actor, sectionId);
  assertInSection(actor, access, 'attendance:manage');
  assertEnabled(access, (await sectionFlags(sectionId)).attendanceEnabled);
  const session = await prisma.courseSection.findUniqueOrThrow({
    where: { id: sectionId },
    select: { session: { select: { startDate: true, endDate: true } } },
  });
  const date = new Date(`${input.date}T00:00:00Z`);
  if (date < session.session.startDate || date > session.session.endDate)
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'The date is outside the session', {
      fields: [{ path: 'body.date', message: 'Choose a date within the session' }],
    });
  const existing = await prisma.attendanceSession.findFirst({
    where: { sectionId, date, startMinute: input.startMinute },
  });
  if (existing)
    throw new ConflictError(ErrorCode.CONFLICT, 'Attendance for this class already exists', {
      id: existing.id,
    });
  const created = await prisma.attendanceSession.create({
    data: {
      sectionId,
      date,
      startMinute: input.startMinute,
      topic: input.topic,
      createdById: actor.userId,
    },
  });
  return { id: created.id };
}

export async function deleteSession(actor: ActorContext, id: string) {
  const s = await prisma.attendanceSession.findUnique({ where: { id } });
  if (!s) throw new NotFoundError('Attendance session');
  const access = await sectionAccess(actor, s.sectionId);
  assertInSection(actor, access, 'attendance:manage');
  await prisma.attendanceSession.delete({ where: { id } });
  await recordAudit(actor, {
    action: 'attendance.session_deleted',
    entityType: 'AttendanceSession',
    entityId: id,
    changes: { sectionId: s.sectionId, date: s.date.toISOString().slice(0, 10) },
  });
}

/** Marks (or re-marks) students for one class; only students on the class list. */
export async function recordAttendance(
  actor: ActorContext,
  id: string,
  input: z.output<typeof attendanceRecordsSchema>,
) {
  const s = await prisma.attendanceSession.findUnique({ where: { id } });
  if (!s) throw new NotFoundError('Attendance session');
  const access = await sectionAccess(actor, s.sectionId);
  assertInSection(actor, access, 'attendance:manage');
  assertEnabled(access, (await sectionFlags(s.sectionId)).attendanceEnabled);
  const listed = new Set((await classList(s.sectionId)).map((x) => x.studentId));
  const unknown = input.records.filter((r) => !listed.has(r.studentId));
  if (unknown.length)
    throw new BusinessRuleError(
      ErrorCode.VALIDATION_ERROR,
      'Some students are not in this section',
      {
        fields: [
          { path: 'body.records', message: `${unknown.length} student(s) not in the section` },
        ],
      },
    );
  await prisma.$transaction(
    input.records.map((r) =>
      prisma.attendanceRecord.upsert({
        where: {
          attendanceSessionId_studentId: { attendanceSessionId: id, studentId: r.studentId },
        },
        create: { attendanceSessionId: id, studentId: r.studentId, status: r.status, note: r.note },
        update: { status: r.status, note: r.note },
      }),
    ),
  );
  return { marked: input.records.length };
}

/** A student's own attendance in a section (FR-ACAD-003). */
export async function myAttendance(actor: ActorContext, sectionId: string) {
  const student = await prisma.student.findUnique({
    where: { userId: actor.userId },
    select: { id: true },
  });
  const held = student
    ? await prisma.courseRegistration.count({
        where: { sectionId, studentId: student.id, status: { in: [...CLASS_LIST] } },
      })
    : 0;
  if (!student || !held) throw new NotFoundError('Section');
  const [flags, sessions] = await Promise.all([
    sectionFlags(sectionId),
    prisma.attendanceSession.findMany({
      where: { sectionId },
      include: { records: { where: { studentId: student.id } } },
      orderBy: [{ date: 'asc' }, { startMinute: 'asc' }],
    }),
  ]);
  const marked = sessions.filter((s) => s.records.length);
  return {
    enabled: flags.attendanceEnabled,
    percent: attendancePercent(marked.map((s) => s.records[0]!.status)),
    sessions: sessions.map((s) => ({
      id: s.id,
      date: s.date.toISOString().slice(0, 10),
      startMinute: s.startMinute,
      topic: s.topic,
      status: s.records[0]?.status ?? null,
    })),
  };
}
