import type { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext } from '../../common/context/actor.js';
import { NotFoundError } from '../../common/exceptions/app-error.js';
import { paging } from '../../common/http/list-query.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import { avatarUrl } from '../files/files.service.js';
import { sectionInclude, sectionToDto } from '../sections/sections.service.js';
import {
  assertInSection,
  canInSection,
  facultyMemberOf,
  sectionAccess,
} from './teaching-access.js';

type Scope = 'current' | 'upcoming' | 'past';
const SESSION_STATUS: Record<Scope, Array<'ACTIVE' | 'PLANNED' | 'COMPLETED' | 'ARCHIVED'>> = {
  current: ['ACTIVE'],
  upcoming: ['PLANNED'],
  past: ['COMPLETED', 'ARCHIVED'],
};

/** Teaching assignments by session phase (FR-FACULTY-003). */
export async function mySections(actor: ActorContext, scope: Scope) {
  const me = await facultyMemberOf(actor);
  const rows = await prisma.courseSection.findMany({
    where: {
      instructors: { some: { facultyMemberId: me.id } },
      session: { status: { in: SESSION_STATUS[scope] } },
      ...(scope === 'past' ? {} : { status: { not: 'CANCELLED' } }),
    },
    include: sectionInclude,
    orderBy: [
      { session: { startDate: scope === 'past' ? 'desc' : 'asc' } },
      { course: { code: 'asc' } },
      { sectionCode: 'asc' },
    ],
  });
  return rows.map((r) => ({
    ...sectionToDto(r, actor),
    myRole: r.instructors.find((i) => i.facultyMemberId === me.id)!.role,
  }));
}

/** Weekday (1 = Monday) and minutes after midnight now, in the university's time zone. */
async function universityNow(now = new Date()) {
  const u = await prisma.university.findFirst({ select: { timezone: true } });
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: u?.timezone ?? 'UTC',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1;
  return {
    dayOfWeek: day,
    minute: Number(get('hour')) * 60 + Number(get('minute')),
    timeZone: u?.timezone ?? 'UTC',
  };
}

/** Faculty dashboard (FR-FACULTY-001): this session's teaching at a glance. */
export async function dashboard(actor: ActorContext) {
  const me = await facultyMemberOf(actor);
  const [current, upcoming, announcements, clock] = await Promise.all([
    mySections(actor, 'current'),
    prisma.courseSection.count({
      where: {
        instructors: { some: { facultyMemberId: me.id } },
        session: { status: 'PLANNED' },
        status: { not: 'CANCELLED' },
      },
    }),
    prisma.announcement.findMany({
      where: { authorId: actor.userId },
      orderBy: { publishedAt: 'desc' },
      take: 5,
      include: { audiences: true },
    }),
    universityNow(),
  ]);
  const today = current
    .flatMap((s) =>
      s.meetings
        .filter((m) => m.dayOfWeek === clock.dayOfWeek)
        .map((m) => ({
          sectionId: s.id,
          course: s.course.code,
          sectionCode: s.sectionCode,
          title: s.course.title,
          startMinute: m.startMinute,
          endMinute: m.endMinute,
          classroom: m.classroom?.label ?? null,
          type: m.type,
        })),
    )
    .sort((a, b) => a.startMinute - b.startMinute);
  const teaching = current.filter((s) => s.myRole !== 'TA');
  return {
    session: current[0]?.session ?? null,
    sections: current,
    totalStudents: current.reduce((sum, s) => sum + s.enrolledCount, 0),
    today: {
      dayOfWeek: clock.dayOfWeek,
      nowMinute: clock.minute,
      timeZone: clock.timeZone,
      classes: today,
    },
    load: {
      credits: teaching.reduce((sum, s) => sum + s.course.credits, 0),
      maxCredits: me.maxLoadCredits?.toNumber() ?? null,
    },
    upcomingSections: upcoming,
    recentAnnouncements: announcements.map((a) => ({
      id: a.id,
      title: a.title,
      priority: a.priority,
      publishedAt: a.publishedAt.toISOString(),
      sectionCount: a.audiences.length,
    })),
  };
}

/** Course workspace header data (FR-FACULTY-004): course content, schedule and class statistics. */
export async function workspace(actor: ActorContext, sectionId: string) {
  const access = await sectionAccess(actor, sectionId);
  assertInSection(actor, access, 'roster:read');
  const [row, course, byStatus, members] = await Promise.all([
    prisma.courseSection.findUniqueOrThrow({ where: { id: sectionId }, include: sectionInclude }),
    prisma.course.findFirstOrThrow({
      where: { sections: { some: { id: sectionId } } },
      select: {
        description: true,
        syllabus: true,
        level: true,
        outcomes: { orderBy: { position: 'asc' }, select: { description: true } },
        assessmentComponents: {
          orderBy: { position: 'asc' },
          select: { name: true, weight: true },
        },
      },
    }),
    prisma.courseRegistration.groupBy({
      by: ['status'],
      where: {
        sectionId,
        status: {
          in: [
            'REGISTERED',
            'PENDING',
            'WAITLISTED',
            'OFFERED',
            'DROPPED',
            'WITHDRAWN',
            'COMPLETED',
          ],
        },
      },
      _count: true,
    }),
    prisma.courseRegistration.findMany({
      where: { sectionId, status: { in: ['REGISTERED', 'PENDING', 'COMPLETED'] } },
      select: { student: { select: { yearOfStudy: true, program: { select: { code: true } } } } },
    }),
  ]);
  const tally = (key: (m: (typeof members)[number]) => string) =>
    Object.entries(
      members.reduce<Record<string, number>>((acc, m) => {
        acc[key(m)] = (acc[key(m)] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return {
    section: sectionToDto(row, actor),
    course: {
      description: course.description,
      syllabus: course.syllabus,
      level: course.level,
      outcomes: course.outcomes.map((o) => o.description),
      assessmentComponents: course.assessmentComponents.map((a) => ({
        name: a.name,
        weight: a.weight.toNumber(),
      })),
    },
    stats: {
      byStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count])),
      byProgram: tally((m) => m.student.program.code),
      byYear: tally((m) => `Year ${m.student.yearOfStudy}`),
    },
    myRole: access.instructor?.role ?? null,
    can: {
      exportRoster: canInSection(actor, access, 'roster:export'),
      manageMaterials: canInSection(actor, access, 'material:manage'),
      announce: canInSection(actor, access, 'announcement:publish_section'),
    },
  };
}

type RosterStatus = 'REGISTERED' | 'PENDING' | 'WAITLISTED' | 'COMPLETED';

function rosterWhere(
  sectionId: string,
  q: { q?: string; status?: RosterStatus },
): Prisma.CourseRegistrationWhereInput {
  return {
    sectionId,
    status: q.status ? q.status : { in: ['REGISTERED', 'PENDING', 'COMPLETED'] },
    ...(q.q
      ? {
          student: {
            OR: [
              { studentNumber: { contains: q.q, mode: 'insensitive' } },
              { user: { firstName: { contains: q.q, mode: 'insensitive' } } },
              { user: { lastName: { contains: q.q, mode: 'insensitive' } } },
              { user: { email: { contains: q.q, mode: 'insensitive' } } },
            ],
          },
        }
      : {}),
  };
}

const rosterSelect = {
  id: true,
  status: true,
  registeredAt: true,
  waitlistedAt: true,
  createdAt: true,
  student: {
    select: {
      id: true,
      studentNumber: true,
      yearOfStudy: true,
      user: { select: { firstName: true, lastName: true, email: true } },
      program: { select: { code: true, name: true } },
      specialization: { select: { name: true } },
    },
  },
} satisfies Prisma.CourseRegistrationSelect;
type RosterRow = Prisma.CourseRegistrationGetPayload<{ select: typeof rosterSelect }>;

const rosterDto = (r: RosterRow) => ({
  registrationId: r.id,
  status: r.status,
  registeredAt: (r.registeredAt ?? r.waitlistedAt ?? r.createdAt).toISOString(),
  student: {
    id: r.student.id,
    studentNumber: r.student.studentNumber,
    name: `${r.student.user.firstName} ${r.student.user.lastName}`,
    email: r.student.user.email,
    program: r.student.program,
    specialization: r.student.specialization?.name ?? null,
    yearOfStudy: r.student.yearOfStudy,
  },
  // Attendance and assessment summaries arrive with Phase 10.
  attendancePercent: null,
});

/** Section roster (FR-FACULTY-005): instructors of the section or administrators in scope. */
export async function roster(
  actor: ActorContext,
  sectionId: string,
  q: { page: number; limit: number; q?: string; status?: RosterStatus },
) {
  const access = await sectionAccess(actor, sectionId);
  assertInSection(actor, access, 'roster:read');
  const where = rosterWhere(sectionId, q);
  const [total, rows] = await Promise.all([
    prisma.courseRegistration.count({ where }),
    prisma.courseRegistration.findMany({
      where,
      select: rosterSelect,
      orderBy: [
        { student: { user: { lastName: 'asc' } } },
        { student: { user: { firstName: 'asc' } } },
        { id: 'asc' },
      ],
      ...paging(q),
    }),
  ]);
  return { total, items: rows.map(rosterDto) };
}

/** Neutralises spreadsheet formulas (CSV injection) and quotes every cell. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** CSV export of the roster (permission roster:export); audited. */
export async function rosterCsv(
  actor: ActorContext,
  sectionId: string,
  q: { status?: RosterStatus },
) {
  const access = await sectionAccess(actor, sectionId);
  assertInSection(actor, access, 'roster:export');
  const rows = await prisma.courseRegistration.findMany({
    where: rosterWhere(sectionId, q),
    select: rosterSelect,
    orderBy: [{ student: { user: { lastName: 'asc' } } }, { id: 'asc' }],
  });
  const header = [
    'Student number',
    'Name',
    'Email',
    'Program',
    'Specialization',
    'Year',
    'Status',
    'Registered at',
  ];
  const lines = rows
    .map(rosterDto)
    .map((r) =>
      [
        r.student.studentNumber,
        r.student.name,
        r.student.email,
        r.student.program.code,
        r.student.specialization,
        r.student.yearOfStudy,
        r.status,
        r.registeredAt,
      ]
        .map(csvCell)
        .join(','),
    );
  await recordAudit(actor, {
    action: 'roster.exported',
    entityType: 'CourseSection',
    entityId: sectionId,
    changes: { rows: rows.length },
  });
  const name = `${access.section.course.code}-${access.section.sectionCode}-roster.csv`.replace(
    /[^A-Za-z0-9._-]/g,
    '_',
  );
  return {
    fileName: name,
    csv: `\uFEFF${[header.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`,
  };
}

/**
 * A student's academic-relevant profile for an instructor of a section they are
 * in (FR-FACULTY-006): no contact details, address or holds.
 */
export async function studentInSection(actor: ActorContext, sectionId: string, studentId: string) {
  const access = await sectionAccess(actor, sectionId);
  assertInSection(actor, access, 'roster:read');
  const reg = await prisma.courseRegistration.findFirst({
    where: {
      sectionId,
      studentId,
      status: { in: ['REGISTERED', 'PENDING', 'WAITLISTED', 'OFFERED', 'COMPLETED'] },
    },
    select: { status: true, registeredAt: true, createdAt: true },
  });
  if (!reg) throw new NotFoundError('Student');
  const s = await prisma.student.findUniqueOrThrow({
    where: { id: studentId },
    select: {
      id: true,
      studentNumber: true,
      yearOfStudy: true,
      status: true,
      cohort: true,
      user: { select: { firstName: true, lastName: true, email: true, avatarFileId: true } },
      program: { select: { code: true, name: true, department: { select: { name: true } } } },
      specialization: { select: { name: true } },
    },
  });
  const otherSections = await prisma.courseRegistration.findMany({
    where: {
      studentId,
      sessionId: access.section.sessionId,
      status: { in: ['REGISTERED', 'PENDING'] },
      section: { instructors: { some: { facultyMember: { userId: actor.userId } } } },
      NOT: { sectionId },
    },
    select: {
      course: { select: { code: true } },
      section: { select: { id: true, sectionCode: true } },
    },
  });
  return {
    id: s.id,
    studentNumber: s.studentNumber,
    name: `${s.user.firstName} ${s.user.lastName}`,
    email: s.user.email,
    avatarUrl: await avatarUrl(s.user.avatarFileId),
    program: { code: s.program.code, name: s.program.name, department: s.program.department.name },
    specialization: s.specialization?.name ?? null,
    yearOfStudy: s.yearOfStudy,
    cohort: s.cohort,
    studentStatus: s.status,
    registration: { status: reg.status, since: (reg.registeredAt ?? reg.createdAt).toISOString() },
    alsoInYourSections: otherSections.map((o) => ({
      sectionId: o.section.id,
      label: `${o.course.code} ${o.section.sectionCode}`,
    })),
  };
}
