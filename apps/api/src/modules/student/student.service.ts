import type { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext } from '../../common/context/actor.js';
import { ForbiddenError, NotFoundError } from '../../common/exceptions/app-error.js';
import { isoDate, num, paging } from '../../common/http/list-query.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { registrationState } from '../academic-sessions/calendar.service.js';
import { searchCourseIds } from '../courses/courses.service.js';
import { sectionInclude, sectionToDto } from '../sections/sections.service.js';

const SEAT = ['PENDING', 'REGISTERED', 'OFFERED'] as const;
const ACTIVE = ['PENDING', 'REGISTERED', 'OFFERED', 'WAITLISTED'] as const;

async function me(actor: ActorContext) {
  const s = await prisma.student.findUnique({
    where: { userId: actor.userId },
    include: {
      user: { select: { firstName: true, lastName: true } },
      program: {
        select: {
          id: true,
          code: true,
          name: true,
          totalCredits: true,
          departmentId: true,
          department: { select: { name: true } },
        },
      },
      specialization: { select: { id: true, code: true, name: true, additionalCredits: true } },
    },
  });
  if (!s) throw new ForbiddenError('Only students have a student portal');
  return s;
}

type PeriodLike = Parameters<typeof registrationState>[0];
const sessionSummary = (s: {
  id: string;
  code: string;
  name: string;
  status: string;
  startDate: Date;
  endDate: Date;
  registrationPeriod: {
    opensAt: Date;
    closesAt: Date;
    lateClosesAt: Date | null;
    addDropDeadline: Date;
    withdrawalDeadline: Date;
  } | null;
}) => ({
  id: s.id,
  code: s.code,
  name: s.name,
  status: s.status,
  startDate: isoDate(s.startDate),
  endDate: isoDate(s.endDate),
  registrationState: registrationState(s.registrationPeriod as PeriodLike),
  period: s.registrationPeriod
    ? {
        opensAt: s.registrationPeriod.opensAt.toISOString(),
        closesAt: s.registrationPeriod.closesAt.toISOString(),
        lateClosesAt: s.registrationPeriod.lateClosesAt?.toISOString() ?? null,
        addDropDeadline: s.registrationPeriod.addDropDeadline.toISOString(),
        withdrawalDeadline: s.registrationPeriod.withdrawalDeadline.toISOString(),
      }
    : null,
});

/** Sessions with published sections, newest first (catalog session picker). */
export async function catalogSessions() {
  const rows = await prisma.academicSession.findMany({
    where: { status: { in: ['PLANNED', 'ACTIVE'] }, sections: { some: { status: 'PUBLISHED' } } },
    include: { registrationPeriod: true },
    orderBy: { startDate: 'asc' },
  });
  return rows.map(sessionSummary);
}

export interface CatalogQuery {
  page: number;
  limit: number;
  sessionId: string;
  q?: string;
  departmentId?: string;
  category?: string;
  level?: number;
  minCredits?: number;
  maxCredits?: number;
  programId?: string;
  specializationId?: string;
  facultyMemberId?: string;
  availability?: 'open' | 'waitlist';
  mine?: boolean;
}

/**
 * Student catalog (FR-STUDENT-003): active courses with published sections in
 * the session, with seat and waitlist availability per course.
 */
export async function catalog(actor: ActorContext, q: CatalogQuery) {
  const student = await me(actor);
  const ids = q.q ? await searchCourseIds(q.q) : null;
  // Column-to-column comparisons are not expressible in Prisma filters.
  const open = q.availability
    ? (
        await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM course_sections
           WHERE session_id = ${q.sessionId}::uuid AND status = 'PUBLISHED' AND registration_open
             AND (CASE WHEN ${q.availability} = 'open' THEN enrolled_count < capacity
                       ELSE enrolled_count >= capacity AND waitlist_count < waitlist_capacity END)`
      ).map((r) => r.id)
    : null;
  const sectionFilter: Prisma.CourseSectionWhereInput = {
    sessionId: q.sessionId,
    status: 'PUBLISHED',
    ...(open ? { id: { in: open } } : {}),
    ...(q.facultyMemberId ? { instructors: { some: { facultyMemberId: q.facultyMemberId } } } : {}),
  };
  const programId = q.mine ? student.programId : q.programId;
  const where: Prisma.CourseWhereInput = {
    status: 'ACTIVE',
    sections: { some: sectionFilter },
    ...(ids ? { id: { in: ids } } : {}),
    ...(q.departmentId ? { departmentId: q.departmentId } : {}),
    ...(q.category ? { category: q.category as never } : {}),
    ...(q.level ? { level: q.level } : {}),
    ...(programId ? { programs: { some: { programId } } } : {}),
    ...(q.specializationId
      ? { specializations: { some: { specializationId: q.specializationId } } }
      : {}),
    ...(q.minCredits !== undefined || q.maxCredits !== undefined
      ? {
          credits: {
            ...(q.minCredits !== undefined ? { gte: q.minCredits } : {}),
            ...(q.maxCredits !== undefined ? { lte: q.maxCredits } : {}),
          },
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.course.count({ where }),
    prisma.course.findMany({
      where,
      include: {
        department: { select: { id: true, code: true, name: true } },
        programs: { where: { programId: student.programId }, select: { mappingType: true } },
        sections: {
          where: { sessionId: q.sessionId, status: 'PUBLISHED' },
          select: {
            id: true,
            enrolledCount: true,
            capacity: true,
            waitlistCount: true,
            waitlistCapacity: true,
            registrationOpen: true,
            instructors: {
              where: { role: 'PRIMARY' },
              select: {
                facultyMember: {
                  select: { user: { select: { firstName: true, lastName: true } } },
                },
              },
            },
          },
        },
        _count: { select: { prerequisiteGroups: true } },
      },
      orderBy: [{ code: 'asc' }],
      ...paging(q),
    }),
  ]);
  const mine = await prisma.courseRegistration.findMany({
    where: {
      studentId: student.id,
      courseId: { in: rows.map((r) => r.id) },
      sessionId: q.sessionId,
      status: { in: [...ACTIVE] },
    },
    select: { courseId: true, status: true },
  });
  const myStatus = new Map(mine.map((m) => [m.courseId, m.status]));
  return {
    total,
    items: rows.map((c) => ({
      id: c.id,
      code: c.code,
      title: c.title,
      description: c.description,
      credits: num(c.credits)!,
      level: c.level,
      category: c.category,
      department: c.department,
      hasPrerequisites: c._count.prerequisiteGroups > 0,
      inMyProgram: c.programs[0]?.mappingType ?? null,
      sections: c.sections.length,
      openSeats: c.sections.reduce(
        (sum, s) => sum + (s.registrationOpen ? Math.max(0, s.capacity - s.enrolledCount) : 0),
        0,
      ),
      waitlistOpen: c.sections.some(
        (s) => s.enrolledCount >= s.capacity && s.waitlistCount < s.waitlistCapacity,
      ),
      instructors: [
        ...new Set(
          c.sections.flatMap((s) =>
            s.instructors.map(
              (i) => `${i.facultyMember.user.firstName} ${i.facultyMember.user.lastName}`,
            ),
          ),
        ),
      ],
      myStatus: myStatus.get(c.id) ?? null,
    })),
  };
}

/**
 * Course detail for students (FR-STUDENT-004): content, prerequisites with the
 * student's own status, and the session's published sections.
 */
export async function catalogCourse(actor: ActorContext, courseId: string, sessionId: string) {
  const student = await me(actor);
  const course = await prisma.course.findFirst({
    where: { id: courseId, status: 'ACTIVE' },
    include: {
      department: { select: { id: true, code: true, name: true } },
      outcomes: { orderBy: { position: 'asc' } },
      assessmentComponents: { orderBy: { position: 'asc' } },
      prerequisiteGroups: {
        orderBy: { position: 'asc' },
        include: {
          items: { include: { requiredCourse: { select: { id: true, code: true, title: true } } } },
        },
      },
      corequisites: { include: { corequisite: { select: { id: true, code: true, title: true } } } },
      restrictions: true,
      programs: { where: { programId: student.programId }, select: { mappingType: true } },
    },
  });
  if (!course) throw new NotFoundError('Course');
  const relevant = [
    ...course.prerequisiteGroups.flatMap((g) => g.items.map((i) => i.requiredCourse.id)),
    ...course.corequisites.map((c) => c.corequisite.id),
    course.id,
  ];
  const [records, active, sections] = await Promise.all([
    prisma.academicRecord.findMany({
      where: { studentId: student.id, courseId: { in: relevant } },
      select: { courseId: true, gradeLetter: true, passed: true },
    }),
    prisma.courseRegistration.findMany({
      where: { studentId: student.id, courseId: { in: relevant }, status: { in: [...ACTIVE] } },
      select: { id: true, courseId: true, status: true, sessionId: true, sectionId: true },
    }),
    prisma.courseSection.findMany({
      where: { courseId, sessionId, status: 'PUBLISHED' },
      include: sectionInclude,
      orderBy: { sectionCode: 'asc' },
    }),
  ]);
  const statusOf = (id: string) => {
    const passed = records.filter((r) => r.courseId === id && r.passed);
    if (passed.length) return { state: 'COMPLETED' as const, grade: passed[0]!.gradeLetter };
    const current = active.find((a) => a.courseId === id);
    if (current)
      return {
        state:
          current.sessionId === sessionId ? ('THIS_SESSION' as const) : ('IN_PROGRESS' as const),
        grade: null,
      };
    return { state: 'MISSING' as const, grade: null };
  };
  const mine = active.find((a) => a.courseId === course.id && a.sessionId === sessionId) ?? null;
  return {
    id: course.id,
    code: course.code,
    title: course.title,
    description: course.description,
    syllabus: course.syllabus,
    credits: num(course.credits)!,
    level: course.level,
    category: course.category,
    department: course.department,
    isRepeatable: course.isRepeatable,
    inMyProgram: course.programs[0]?.mappingType ?? null,
    outcomes: course.outcomes.map((o) => o.description),
    assessmentComponents: course.assessmentComponents.map((a) => ({
      name: a.name,
      weight: a.weight.toNumber(),
    })),
    prerequisites: course.prerequisiteGroups.map((g) => ({
      items: g.items.map((i) => ({
        course: i.requiredCourse,
        minGradeLetter: i.minGradeLetter,
        ...statusOf(i.requiredCourse.id),
      })),
    })),
    corequisites: course.corequisites.map((c) => ({
      course: c.corequisite,
      ...statusOf(c.corequisite.id),
    })),
    hasRestrictions: course.restrictions.length > 0,
    completed: statusOf(course.id).state === 'COMPLETED',
    myRegistration: mine ? { id: mine.id, status: mine.status, sectionId: mine.sectionId } : null,
    sections: sections.map((s) => sectionToDto(s, actor)),
  };
}

/** Weekly timetable for a session (FR-STUDENT-010): seat-holding registrations only. */
export async function timetable(actor: ActorContext, sessionId: string) {
  const student = await me(actor);
  const regs = await prisma.courseRegistration.findMany({
    where: { studentId: student.id, sessionId, status: { in: [...SEAT] } },
    include: {
      course: { select: { code: true, title: true } },
      section: {
        select: {
          id: true,
          sectionCode: true,
          meetings: { include: { classroom: { select: { building: true, roomNumber: true } } } },
          instructors: {
            where: { role: 'PRIMARY' },
            select: {
              facultyMember: { select: { user: { select: { firstName: true, lastName: true } } } },
            },
          },
        },
      },
    },
  });
  const session = await prisma.academicSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new NotFoundError('Session');
  return {
    session: {
      id: session.id,
      name: session.name,
      startDate: isoDate(session.startDate),
      endDate: isoDate(session.endDate),
    },
    entries: regs.flatMap((r) =>
      r.section.meetings.map((m) => {
        const i = r.section.instructors[0]?.facultyMember.user;
        return {
          id: m.id,
          registrationId: r.id,
          status: r.status,
          sectionId: r.section.id,
          course: r.course.code,
          title: r.course.title,
          sectionCode: r.section.sectionCode,
          dayOfWeek: m.dayOfWeek,
          startMinute: m.startMinute,
          endMinute: m.endMinute,
          type: m.type,
          room: m.classroom ? `${m.classroom.building} ${m.classroom.roomNumber}` : null,
          instructor: i ? `${i.firstName} ${i.lastName}` : null,
        };
      }),
    ),
  };
}

const ICS_DAYS = ['', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const icsText = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
const pad = (n: number) => String(n).padStart(2, '0');

/** iCalendar export of the timetable (FR-STUDENT-010, S): weekly events across the session, in the university's zone. */
export async function timetableIcs(actor: ActorContext, sessionId: string) {
  const t = await timetable(actor, sessionId);
  const u = await prisma.university.findFirst({ select: { timezone: true, shortName: true } });
  const tz = u?.timezone ?? 'UTC';
  const start = new Date(`${t.session.startDate}T00:00:00Z`);
  const until = t.session.endDate.replace(/-/g, '') + 'T235959Z';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${u?.shortName ?? 'UCRAMS'}//Timetable//EN`,
    'CALSCALE:GREGORIAN',
  ];
  for (const e of t.entries) {
    // First occurrence: the first matching weekday on or after the session start.
    const first = new Date(start);
    const startDay = ((first.getUTCDay() + 6) % 7) + 1;
    first.setUTCDate(first.getUTCDate() + ((e.dayOfWeek - startDay + 7) % 7));
    const day = `${first.getUTCFullYear()}${pad(first.getUTCMonth() + 1)}${pad(first.getUTCDate())}`;
    const at = (m: number) => `${day}T${pad(Math.floor(m / 60))}${pad(m % 60)}00`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}-${e.registrationId}@ucrams`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${tz}:${at(e.startMinute)}`,
      `DTEND;TZID=${tz}:${at(e.endMinute)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${ICS_DAYS[e.dayOfWeek]};UNTIL=${until}`,
      `SUMMARY:${icsText(`${e.course} ${e.sectionCode} ${e.title}`)}`,
      ...(e.room ? [`LOCATION:${icsText(e.room)}`] : []),
      ...(e.instructor ? [`DESCRIPTION:${icsText(`Instructor: ${e.instructor}`)}`] : []),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return {
    fileName: `timetable-${t.session.name.replace(/\W+/g, '-').toLowerCase()}.ics`,
    ics: lines.join('\r\n') + '\r\n',
  };
}

/** Academic history by session with session GPA and CGPA (FR-STUDENT-011, FR-ACAD-008). */
export async function history(actor: ActorContext) {
  const student = await me(actor);
  const [records, withdrawn] = await Promise.all([
    prisma.academicRecord.findMany({
      where: { studentId: student.id },
      include: { session: { select: { id: true, name: true, startDate: true } } },
      orderBy: [{ session: { startDate: 'asc' } }, { courseCodeSnapshot: 'asc' }],
    }),
    prisma.courseRegistration.findMany({
      where: { studentId: student.id, status: 'WITHDRAWN' },
      include: {
        course: { select: { code: true, title: true } },
        session: { select: { id: true, name: true, startDate: true } },
      },
    }),
  ]);
  const gpa = (rows: typeof records) => {
    const counted = rows.filter((r) => r.countsInGpa && r.gradePoints !== null);
    const credits = counted.reduce((s, r) => s + r.creditsAttempted.toNumber(), 0);
    if (!credits) return null;
    return (
      Math.round(
        (counted.reduce(
          (s, r) => s + r.gradePoints!.toNumber() * r.creditsAttempted.toNumber(),
          0,
        ) /
          credits) *
          100,
      ) / 100
    );
  };
  const sessions = new Map<
    string,
    { id: string; name: string; start: Date; courses: unknown[]; rows: typeof records }
  >();
  const bucket = (s: { id: string; name: string; startDate: Date } | null) => {
    const key = s?.id ?? 'transfer';
    if (!sessions.has(key))
      sessions.set(key, {
        id: key,
        name: s?.name ?? 'Transfer and exemptions',
        start: s?.startDate ?? new Date(0),
        courses: [],
        rows: [],
      });
    return sessions.get(key)!;
  };
  for (const r of records) {
    const b = bucket(r.session);
    b.rows.push(r);
    b.courses.push({
      courseId: r.courseId,
      code: r.courseCodeSnapshot,
      title: r.courseTitleSnapshot,
      credits: r.creditsAttempted.toNumber(),
      creditsEarned: r.creditsEarned.toNumber(),
      grade: r.gradeLetter,
      passed: r.passed,
    });
  }
  for (const w of withdrawn) {
    bucket(w.session).courses.push({
      courseId: w.courseId,
      code: w.course.code,
      title: w.course.title,
      credits: w.credits.toNumber(),
      creditsEarned: 0,
      grade: 'W',
      passed: false,
    });
  }
  return {
    sessions: [...sessions.values()]
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((s) => ({
        id: s.id,
        name: s.name,
        courses: s.courses,
        credits: s.rows.reduce((sum, r) => sum + r.creditsEarned.toNumber(), 0),
        gpa: gpa(s.rows),
      })),
    creditsEarned: records.reduce((s, r) => s + r.creditsEarned.toNumber(), 0),
    cgpa: gpa(records),
  };
}

type CourseState = 'COMPLETED' | 'IN_PROGRESS' | 'PENDING';

/**
 * Degree progress (FR-STUDENT-009): program credit totals and each requirement
 * group with completed / in-progress / pending courses. Completed courses are
 * counted once, in the first group they fit (ALL_OF, then lists, then
 * categories, then free credits).
 */
export async function progress(actor: ActorContext) {
  const student = await me(actor);
  const [groups, records, current] = await Promise.all([
    prisma.requirementGroup.findMany({
      where: {
        OR: [
          { programId: student.programId },
          ...(student.specializationId ? [{ specializationId: student.specializationId }] : []),
        ],
      },
      include: {
        courses: {
          include: {
            course: {
              select: { id: true, code: true, title: true, credits: true, category: true },
            },
          },
        },
      },
      orderBy: { position: 'asc' },
    }),
    prisma.academicRecord.findMany({
      where: { studentId: student.id, passed: true },
      include: { course: { select: { category: true } } },
    }),
    prisma.courseRegistration.findMany({
      where: {
        studentId: student.id,
        status: { in: ['REGISTERED', 'PENDING'] },
        session: { status: { in: ['ACTIVE', 'PLANNED'] } },
      },
      include: { course: { select: { id: true, code: true, title: true, category: true } } },
    }),
  ]);
  const done = new Map(records.map((r) => [r.courseId, r]));
  const doing = new Map(current.map((r) => [r.courseId, r]));
  const used = new Set<string>();
  const order = {
    ALL_OF: 0,
    CREDITS_FROM_LIST: 1,
    CREDITS_FROM_CATEGORY: 2,
    CREDITS_ANY: 3,
  } as const;
  const state = (id: string): CourseState =>
    done.has(id) ? 'COMPLETED' : doing.has(id) ? 'IN_PROGRESS' : 'PENDING';
  const results = [...groups]
    .sort((a, b) => order[a.kind] - order[b.kind] || a.position - b.position)
    .map((g) => {
      let courses: Array<{
        id: string;
        code: string;
        title: string;
        credits: number;
        state: CourseState;
      }>;
      if (g.kind === 'ALL_OF' || g.kind === 'CREDITS_FROM_LIST') {
        courses = g.courses.map((c) => ({
          id: c.course.id,
          code: c.course.code,
          title: c.course.title,
          credits: c.course.credits.toNumber(),
          state: state(c.course.id),
        }));
      } else {
        const fits = (category: string) => g.kind === 'CREDITS_ANY' || category === g.category;
        courses = [
          ...records
            .filter((r) => !used.has(r.courseId) && fits(r.course.category))
            .map((r) => ({
              id: r.courseId,
              code: r.courseCodeSnapshot,
              title: r.courseTitleSnapshot,
              credits: r.creditsEarned.toNumber(),
              state: 'COMPLETED' as const,
            })),
          ...current
            .filter((r) => !used.has(r.courseId) && fits(r.course.category))
            .map((r) => ({
              id: r.courseId,
              code: r.course.code,
              title: r.course.title,
              credits: r.credits.toNumber(),
              state: 'IN_PROGRESS' as const,
            })),
        ];
      }
      // A completed course counts towards one group only.
      const counted = courses.filter((c) => c.state !== 'PENDING' && !used.has(c.id));
      counted.forEach((c) => used.add(c.id));
      const sum = (s: CourseState) =>
        counted.filter((c) => c.state === s).reduce((t, c) => t + c.credits, 0);
      const required =
        g.kind === 'ALL_OF'
          ? courses.reduce((t, c) => t + c.credits, 0)
          : (g.minCredits?.toNumber() ?? 0);
      return {
        id: g.id,
        name: g.name,
        kind: g.kind,
        category: g.category,
        source: g.specializationId ? 'SPECIALIZATION' : 'PROGRAM',
        requiredCredits: required,
        completedCredits: Math.min(sum('COMPLETED'), required || Infinity),
        inProgressCredits: sum('IN_PROGRESS'),
        satisfied:
          g.kind === 'ALL_OF'
            ? courses.length > 0 && courses.every((c) => c.state === 'COMPLETED')
            : sum('COMPLETED') >= required,
        courses,
      };
    });
  const totalRequired =
    student.program.totalCredits.toNumber() +
    (student.specialization?.additionalCredits?.toNumber() ?? 0);
  const completed = records.reduce((s, r) => s + r.creditsEarned.toNumber(), 0);
  const inProgress = current.reduce((s, r) => s + r.credits.toNumber(), 0);
  return {
    program: { code: student.program.code, name: student.program.name },
    specialization: student.specialization
      ? { code: student.specialization.code, name: student.specialization.name }
      : null,
    totalRequired,
    completed,
    inProgress,
    remaining: Math.max(0, totalRequired - completed - inProgress),
    groups: results.sort(
      (a, b) => groups.findIndex((g) => g.id === a.id) - groups.findIndex((g) => g.id === b.id),
    ),
  };
}

/** Announcements for the student's current and upcoming sections. */
export async function announcementFeed(actor: ActorContext, limit = 30) {
  const student = await me(actor);
  const sections = await prisma.courseRegistration.findMany({
    where: { studentId: student.id, status: { in: ['REGISTERED', 'PENDING'] } },
    select: {
      sectionId: true,
      course: { select: { code: true } },
      section: { select: { sectionCode: true } },
    },
  });
  const labels = new Map(
    sections.map((s) => [s.sectionId, `${s.course.code} ${s.section.sectionCode}`]),
  );
  const now = new Date();
  const rows = await prisma.announcement.findMany({
    where: {
      audiences: { some: { targetType: 'SECTION', targetId: { in: [...labels.keys()] } } },
      publishedAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    include: { author: { select: { firstName: true, lastName: true } }, audiences: true },
    orderBy: [{ publishedAt: 'desc' }],
    take: limit,
  });
  return rows.map((a) => ({
    id: a.id,
    title: a.title,
    body: a.body,
    priority: a.priority,
    pinned: a.pinned,
    publishedAt: a.publishedAt.toISOString(),
    author: `${a.author.firstName} ${a.author.lastName}`,
    sections: a.audiences
      .filter((x) => labels.has(x.targetId))
      .map((x) => ({ id: x.targetId, label: labels.get(x.targetId)! })),
  }));
}

/** Student dashboard (FR-STUDENT-001). */
export async function dashboard(actor: ActorContext) {
  const student = await me(actor);
  const sessions = await prisma.academicSession.findMany({
    where: { status: { in: ['ACTIVE', 'PLANNED'] } },
    include: { registrationPeriod: true },
    orderBy: { startDate: 'asc' },
  });
  const current = sessions.find((s) => s.status === 'ACTIVE') ?? null;
  const registering =
    sessions
      .map(sessionSummary)
      .find((s) => ['OPEN', 'LATE', 'UPCOMING'].includes(s.registrationState)) ?? null;
  const [regs, prog, feed, holds] = await Promise.all([
    prisma.courseRegistration.findMany({
      where: {
        studentId: student.id,
        status: { in: [...ACTIVE] },
        session: { status: { in: ['ACTIVE', 'PLANNED'] } },
      },
      include: {
        course: { select: { code: true, title: true } },
        section: { select: { id: true, sectionCode: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    progress(actor),
    announcementFeed(actor, 5),
    prisma.registrationHold.count({ where: { studentId: student.id, releasedAt: null } }),
  ]);
  const inSession = (sid: string | undefined) => regs.filter((r) => r.sessionId === sid);
  const credits = (list: typeof regs) =>
    list.filter((r) => r.status !== 'WAITLISTED').reduce((s, r) => s + r.credits.toNumber(), 0);
  const brief = (r: (typeof regs)[number]) => ({
    id: r.id,
    status: r.status,
    sectionId: r.section.id,
    label: `${r.course.code} ${r.section.sectionCode}`,
    title: r.course.title,
    credits: r.credits.toNumber(),
    offerExpiresAt: r.offerExpiresAt?.toISOString() ?? null,
  });
  return {
    profile: {
      name: `${student.user.firstName} ${student.user.lastName}`,
      studentNumber: student.studentNumber,
      program: { code: student.program.code, name: student.program.name },
      department: student.program.department.name,
      specialization: student.specialization?.name ?? null,
      yearOfStudy: student.yearOfStudy,
      activeHolds: holds,
    },
    currentSession: current
      ? {
          ...sessionSummary(current),
          courses: inSession(current.id).map(brief),
          credits: credits(inSession(current.id)),
        }
      : null,
    registrationSession: registering
      ? {
          ...registering,
          courses: inSession(registering.id).map(brief),
          credits: credits(inSession(registering.id)),
        }
      : null,
    pending: regs.filter((r) => r.status !== 'REGISTERED').map(brief),
    progress: {
      totalRequired: prog.totalRequired,
      completed: prog.completed,
      inProgress: prog.inProgress,
    },
    announcements: feed,
  };
}
