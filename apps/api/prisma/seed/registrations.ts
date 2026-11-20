/**
 * Registration seed (Phase 6): graded history for the completed sessions,
 * current timetables in the active session, and an open Spring 2027 window with
 * registrations, full sections, waitlists and pending approvals. Deterministic;
 * runs once (skipped when any registration exists). Counters are recomputed at
 * the end by the same reconciliation job production uses.
 */
import { meetingsOverlap } from '@ucrams/shared';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { reconcileCounters } from '../../src/modules/registrations/waitlist.service.js';
import { seedSessionSections } from './courses.js';

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(6_2026_11_20);
const shuffle = <T>(list: T[]) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

/** Grade distribution for seeded history (weights per letter of the example scale). */
const GRADE_WEIGHTS: Array<[string, number]> = [
  ['O', 10],
  ['A+', 20],
  ['A', 24],
  ['B+', 20],
  ['B', 12],
  ['C', 8],
  ['P', 4],
  ['F', 2],
];
function pickGrade() {
  let r = rand() * 100;
  for (const [letter, w] of GRADE_WEIGHTS) if ((r -= w) <= 0) return letter;
  return 'B';
}

type SectionRow = {
  id: string;
  courseId: string;
  sessionId: string;
  capacity: number;
  status: string;
  credits: number;
  level: number;
  category: string;
  departmentId: string;
  code: string;
  title: string;
  meetings: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>;
};

async function sectionsOf(sessionId: string, statuses: string[]): Promise<SectionRow[]> {
  const rows = await prisma.courseSection.findMany({
    where: { sessionId, status: { in: statuses as never } },
    include: {
      course: {
        select: {
          code: true,
          title: true,
          credits: true,
          level: true,
          category: true,
          departmentId: true,
        },
      },
      meetings: { select: { dayOfWeek: true, startMinute: true, endMinute: true } },
    },
    orderBy: [{ course: { code: 'asc' } }, { sectionCode: 'asc' }],
  });
  return rows.map((s) => ({
    id: s.id,
    courseId: s.courseId,
    sessionId: s.sessionId,
    capacity: s.capacity,
    status: s.status,
    credits: s.course.credits.toNumber(),
    level: s.course.level,
    category: s.course.category,
    departmentId: s.course.departmentId,
    code: s.course.code,
    title: s.course.title,
    meetings: s.meetings,
  }));
}

type Student = {
  id: string;
  userId: string;
  yearOfStudy: number;
  departmentId: string;
  studentNumber: string;
};

/**
 * Greedy timetable for one student: department sections at the wanted levels,
 * no clashes, within the credit cap and the seats left.
 */
function choose(
  student: Student,
  pool: SectionRow[],
  seats: Map<string, number>,
  opts: { levels: number[]; maxCredits: number; maxCourses: number; taken: Set<string> },
) {
  const chosen: SectionRow[] = [];
  let credits = 0;
  const candidates = shuffle(
    pool.filter(
      (s) =>
        s.departmentId === student.departmentId &&
        opts.levels.includes(s.level) &&
        !opts.taken.has(s.courseId),
    ),
  );
  for (const s of candidates) {
    if (chosen.length >= opts.maxCourses) break;
    if ((seats.get(s.id) ?? 0) >= s.capacity) continue;
    if (credits + s.credits > opts.maxCredits) continue;
    if (chosen.some((c) => c.courseId === s.courseId)) continue;
    if (chosen.some((c) => c.meetings.some((m) => s.meetings.some((x) => meetingsOverlap(m, x)))))
      continue;
    chosen.push(s);
    credits += s.credits;
    seats.set(s.id, (seats.get(s.id) ?? 0) + 1);
  }
  return chosen;
}

async function insertRegistrations(
  rows: Prisma.CourseRegistrationCreateManyInput[],
  action: (r: Prisma.CourseRegistrationCreateManyInput) => string,
) {
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const created = await prisma.courseRegistration.createManyAndReturn({
      data: chunk,
      select: { id: true, status: true, createdAt: true },
    });
    await prisma.registrationEvent.createMany({
      data: created.map((c, j) => ({
        registrationId: c.id,
        fromStatus: null,
        toStatus: c.status,
        action: action(chunk[j]!),
        createdAt: c.createdAt,
      })),
    });
  }
}

export async function seedRegistrations() {
  if ((await prisma.courseRegistration.count()) > 0) return { created: 0 };
  const sessions = new Map(
    (
      await prisma.academicSession.findMany({ select: { id: true, code: true, startDate: true } })
    ).map((s) => [s.code, s]),
  );
  // Spring 2027 is the open registration window in the seeded calendar.
  await seedSessionSections('SPRING-2027', {
    levels: [100, 200, 300, 400],
    status: 'PUBLISHED',
    publishShare: 0.95,
    multiSection: true,
  });

  const students: Student[] = (
    await prisma.student.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        userId: true,
        yearOfStudy: true,
        studentNumber: true,
        program: { select: { departmentId: true } },
      },
      orderBy: { studentNumber: 'asc' },
    })
  ).map((s) => ({
    id: s.id,
    userId: s.userId,
    yearOfStudy: s.yearOfStudy,
    departmentId: s.program.departmentId,
    studentNumber: s.studentNumber,
  }));
  // The dev student goes first so their history is complete regardless of seats.
  students.sort(
    (a, b) => Number(b.studentNumber === '25CS9001') - Number(a.studentNumber === '25CS9001'),
  );
  const scale = await prisma.gradeScaleEntry.findMany({
    where: { scale: { name: 'Example 10-point scale' } },
    select: { letter: true, gradePoints: true, isPassing: true },
  });
  const gradeInfo = new Map(scale.map((g) => [g.letter, g]));
  const taken = new Map<string, Set<string>>(students.map((s) => [s.id, new Set<string>()]));
  let created = 0;

  // 1. History: completed sessions become COMPLETED registrations with academic records.
  for (const code of ['FALL-2025', 'SPRING-2026']) {
    const session = sessions.get(code);
    if (!session) continue;
    const pool = await sectionsOf(session.id, ['COMPLETED']);
    const seats = new Map<string, number>();
    const regs: Prisma.CourseRegistrationCreateManyInput[] = [];
    const meta: Array<{ student: Student; section: SectionRow; grade: string }> = [];
    for (const student of students.filter((s) => s.yearOfStudy >= 2)) {
      const levels = [100, 200, 300, 400].filter((l) => l < student.yearOfStudy * 100);
      for (const s of choose(student, pool, seats, {
        levels,
        maxCredits: 20,
        maxCourses: 4,
        taken: taken.get(student.id)!,
      })) {
        const grade = student.studentNumber === '25CS9001' ? 'A' : pickGrade();
        if (gradeInfo.get(grade)?.isPassing) taken.get(student.id)!.add(s.courseId);
        const at = new Date(session.startDate.getTime() - 14 * 24 * 3600_000);
        regs.push({
          studentId: student.id,
          sectionId: s.id,
          courseId: s.courseId,
          sessionId: session.id,
          status: 'COMPLETED',
          credits: s.credits,
          registeredAt: at,
          createdAt: at,
        });
        meta.push({ student, section: s, grade });
      }
    }
    await insertRegistrations(regs, () => 'REGISTERED');
    // Records reference the registrations just created.
    const byKey = new Map(
      (
        await prisma.courseRegistration.findMany({
          where: { sessionId: session.id },
          select: { id: true, studentId: true, sectionId: true },
        })
      ).map((r) => [`${r.studentId}:${r.sectionId}`, r.id]),
    );
    const records = meta.map(({ student, section, grade }) => {
      const g = gradeInfo.get(grade)!;
      return {
        studentId: student.id,
        courseId: section.courseId,
        sessionId: session.id,
        registrationId: byKey.get(`${student.id}:${section.id}`)!,
        source: 'ENROLLMENT' as const,
        courseCodeSnapshot: section.code,
        courseTitleSnapshot: section.title,
        creditsAttempted: section.credits,
        creditsEarned: g.isPassing ? section.credits : 0,
        gradeLetter: grade,
        gradePoints: g.gradePoints,
        countsInGpa: true,
        passed: g.isPassing,
      };
    });
    for (let i = 0; i < records.length; i += 1000)
      await prisma.academicRecord.createMany({ data: records.slice(i, i + 1000) });
    created += regs.length;
  }

  // 2. The active session: everyone has a timetable at their year's level.
  const fall = sessions.get('FALL-2026');
  if (fall) {
    const pool = await sectionsOf(fall.id, ['PUBLISHED']);
    const seats = new Map<string, number>();
    const regs: Prisma.CourseRegistrationCreateManyInput[] = [];
    for (const student of students) {
      const level = Math.min(student.yearOfStudy, 4) * 100;
      for (const s of choose(student, pool, seats, {
        levels: [level],
        maxCredits: 20,
        maxCourses: 5,
        taken: taken.get(student.id)!,
      })) {
        const at = new Date('2026-07-20T06:00:00Z');
        regs.push({
          studentId: student.id,
          sectionId: s.id,
          courseId: s.courseId,
          sessionId: fall.id,
          status: 'REGISTERED',
          credits: s.credits,
          registeredAt: at,
          createdAt: at,
        });
        taken.get(student.id)!.add(s.courseId);
      }
    }
    await insertRegistrations(regs, () => 'REGISTERED');
    created += regs.length;
  }

  // 3. Spring 2027 (open now): early registrations, a few full sections with waitlists,
  //    and cross-department requests awaiting approval.
  const spring = sessions.get('SPRING-2027');
  if (spring) {
    const pool = await sectionsOf(spring.id, ['PUBLISHED']);
    const seats = new Map<string, number>();
    const regs: Prisma.CourseRegistrationCreateManyInput[] = [];
    const early = students.filter((s, i) => i % 3 === 0 && s.studentNumber !== '25CS9001');
    for (const student of early) {
      const level = Math.min(student.yearOfStudy + 1, 4) * 100;
      for (const s of choose(student, pool, seats, {
        levels: [level],
        maxCredits: 16,
        maxCourses: 3,
        taken: taken.get(student.id)!,
      })) {
        const at = new Date(Date.UTC(2026, 10, 18, 4, Math.floor(rand() * 600)));
        regs.push({
          studentId: student.id,
          sectionId: s.id,
          courseId: s.courseId,
          sessionId: spring.id,
          status: 'REGISTERED',
          credits: s.credits,
          registeredAt: at,
          createdAt: at,
        });
        taken.get(student.id)!.add(s.courseId);
      }
    }
    // Fill six popular first-year sections and put people on their waitlists.
    const popular = pool
      .filter((s) => s.level === 100 && s.category === 'CORE' && s.code !== 'CS101')
      .slice(0, 6);
    const waitlisted: Prisma.CourseRegistrationCreateManyInput[] = [];
    for (const s of popular) {
      const inDept = shuffle(
        students.filter(
          (st) =>
            st.departmentId === s.departmentId &&
            st.studentNumber !== '25CS9001' &&
            !taken.get(st.id)!.has(s.courseId),
        ),
      );
      // Seminar-sized: leave four candidates over so the section fills and gains a waitlist.
      s.capacity = Math.max(seats.get(s.id) ?? 0, 1, Math.min(15, inDept.length - 4));
      await prisma.courseSection.update({ where: { id: s.id }, data: { capacity: s.capacity } });
      let k = 0;
      for (const st of inDept) {
        if ((seats.get(s.id) ?? 0) < s.capacity) {
          seats.set(s.id, (seats.get(s.id) ?? 0) + 1);
          regs.push({
            studentId: st.id,
            sectionId: s.id,
            courseId: s.courseId,
            sessionId: spring.id,
            status: 'REGISTERED',
            credits: s.credits,
            registeredAt: new Date('2026-11-18T05:00:00Z'),
            createdAt: new Date('2026-11-18T05:00:00Z'),
          });
        } else if (k < 4) {
          const at = new Date(Date.UTC(2026, 10, 19, 6, k * 7));
          waitlisted.push({
            studentId: st.id,
            sectionId: s.id,
            courseId: s.courseId,
            sessionId: spring.id,
            status: 'WAITLISTED',
            credits: s.credits,
            waitlistedAt: at,
            createdAt: at,
          });
          k++;
        } else break;
        taken.get(st.id)!.add(s.courseId);
      }
    }
    const pending: Prisma.CourseRegistrationCreateManyInput[] = [];
    const electives = pool.filter((s) => s.category === 'ELECTIVE');
    for (const st of students.filter((s) => s.yearOfStudy >= 3).slice(0, 12)) {
      const s = electives.find(
        (e) =>
          e.departmentId !== st.departmentId &&
          (seats.get(e.id) ?? 0) < e.capacity &&
          !taken.get(st.id)!.has(e.courseId),
      );
      if (!s) continue;
      seats.set(s.id, (seats.get(s.id) ?? 0) + 1);
      taken.get(st.id)!.add(s.courseId);
      pending.push({
        studentId: st.id,
        sectionId: s.id,
        courseId: s.courseId,
        sessionId: spring.id,
        status: 'PENDING',
        credits: s.credits,
        createdAt: new Date('2026-11-19T09:30:00Z'),
      });
    }
    await insertRegistrations(regs, () => 'REGISTERED');
    await insertRegistrations(waitlisted, () => 'WAITLISTED');
    await insertRegistrations(pending, () => 'REQUESTED');
    created += regs.length + waitlisted.length + pending.length;
  }

  // Rows above were inserted without touching counters; this sets them.
  await reconcileCounters({ expected: true });
  return { created };
}
