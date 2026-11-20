import type { GpaRepeatPolicy } from '@ucrams/shared';
import type { ActorContext } from '../../common/context/actor.js';
import { NotFoundError } from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { covers } from '../authz/authz.js';

export interface GpaRow {
  id: string;
  courseId: string;
  creditsAttempted: number;
  creditsEarned: number;
  gradePoints: number | null;
  countsInGpa: boolean;
  /** Ordering of attempts: session start, then creation. */
  order: number;
}

/**
 * Attempts superseded under the repeat policy (FR-ACAD-008): LATEST keeps the
 * most recent attempt at each course, BEST the one with the most grade points,
 * ALL keeps every attempt.
 */
export function supersededAttempts(rows: GpaRow[], policy: GpaRepeatPolicy): Set<string> {
  if (policy === 'ALL') return new Set();
  const byCourse = new Map<string, GpaRow[]>();
  for (const r of rows) byCourse.set(r.courseId, [...(byCourse.get(r.courseId) ?? []), r]);
  const out = new Set<string>();
  for (const attempts of byCourse.values()) {
    if (attempts.length < 2) continue;
    const keep = [...attempts].sort((a, b) =>
      policy === 'LATEST'
        ? b.order - a.order
        : (b.gradePoints ?? -1) - (a.gradePoints ?? -1) || b.order - a.order,
    )[0]!;
    for (const a of attempts) if (a.id !== keep.id) out.add(a.id);
  }
  return out;
}

/** Σ(points × credits) / Σ(credits) over GPA-counting attempts; null without graded credits. */
export function gpaOf(rows: GpaRow[]): number | null {
  const counted = rows.filter((r) => r.countsInGpa && r.gradePoints !== null);
  const credits = counted.reduce((s, r) => s + r.creditsAttempted, 0);
  if (!credits) return null;
  const points = counted.reduce((s, r) => s + r.gradePoints! * r.creditsAttempted, 0);
  return Math.round((points / credits) * 100) / 100;
}

/**
 * The student's academic record by session: courses with grades (W for
 * withdrawals), session GPA over that session's attempts, cumulative GPA and
 * earned credits under the university's repeat policy.
 */
export async function buildTranscript(studentId: string) {
  const [student, university, records, withdrawn] = await Promise.all([
    prisma.student.findUnique({
      where: { id: studentId },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        program: {
          select: {
            code: true,
            name: true,
            department: { select: { name: true, school: { select: { name: true } } } },
          },
        },
        specialization: { select: { name: true } },
      },
    }),
    prisma.university.findFirst({ select: { name: true, gpaRepeatPolicy: true } }),
    prisma.academicRecord.findMany({
      where: { studentId },
      include: { session: { select: { id: true, name: true, startDate: true } } },
      orderBy: [{ session: { startDate: 'asc' } }, { courseCodeSnapshot: 'asc' }],
    }),
    prisma.courseRegistration.findMany({
      where: { studentId, status: 'WITHDRAWN' },
      include: {
        course: { select: { code: true, title: true } },
        session: { select: { id: true, name: true, startDate: true } },
      },
    }),
  ]);
  if (!student) throw new NotFoundError('Student');
  const policy = university?.gpaRepeatPolicy ?? 'ALL';
  const rows: GpaRow[] = records.map((r) => ({
    id: r.id,
    courseId: r.courseId,
    creditsAttempted: r.creditsAttempted.toNumber(),
    creditsEarned: r.creditsEarned.toNumber(),
    gradePoints: r.gradePoints?.toNumber() ?? null,
    countsInGpa: r.countsInGpa,
    order: (r.session?.startDate.getTime() ?? 0) + r.createdAt.getTime() / 1e13,
  }));
  const superseded = supersededAttempts(rows, policy);
  const rowById = new Map(rows.map((r) => [r.id, r]));

  type Course = {
    recordId: string | null;
    courseId: string;
    code: string;
    title: string;
    credits: number;
    creditsEarned: number;
    grade: string | null;
    gradePoints: number | null;
    passed: boolean;
    source: string;
    repeatedLater: boolean;
    version: number;
  };
  const sessions = new Map<
    string,
    { id: string; name: string; start: number; courses: Course[]; rows: GpaRow[] }
  >();
  const bucket = (s: { id: string; name: string; startDate: Date } | null) => {
    const key = s?.id ?? 'transfer';
    if (!sessions.has(key))
      sessions.set(key, {
        id: key,
        name: s?.name ?? 'Transfer and exemptions',
        start: s?.startDate.getTime() ?? 0,
        courses: [],
        rows: [],
      });
    return sessions.get(key)!;
  };
  for (const r of records) {
    const b = bucket(r.session);
    b.rows.push(rowById.get(r.id)!);
    b.courses.push({
      recordId: r.id,
      courseId: r.courseId,
      code: r.courseCodeSnapshot,
      title: r.courseTitleSnapshot,
      credits: r.creditsAttempted.toNumber(),
      creditsEarned: r.creditsEarned.toNumber(),
      grade: r.gradeLetter,
      gradePoints: r.gradePoints?.toNumber() ?? null,
      passed: r.passed,
      source: r.source,
      repeatedLater: superseded.has(r.id),
      version: r.version,
    });
  }
  for (const w of withdrawn)
    bucket(w.session).courses.push({
      recordId: null,
      courseId: w.courseId,
      code: w.course.code,
      title: w.course.title,
      credits: w.credits.toNumber(),
      creditsEarned: 0,
      grade: 'W',
      gradePoints: null,
      passed: false,
      source: 'ENROLLMENT',
      repeatedLater: false,
      version: 1,
    });
  const kept = rows.filter((r) => !superseded.has(r.id));
  return {
    university: university?.name ?? null,
    repeatPolicy: policy,
    student: {
      id: student.id,
      studentNumber: student.studentNumber,
      name: `${student.user.firstName} ${student.user.lastName}`,
      email: student.user.email,
      status: student.status,
      program: { code: student.program.code, name: student.program.name },
      department: student.program.department.name,
      school: student.program.department.school.name,
      specialization: student.specialization?.name ?? null,
      yearOfStudy: student.yearOfStudy,
    },
    sessions: [...sessions.values()]
      .sort((a, b) => a.start - b.start)
      .map((s) => ({
        id: s.id,
        name: s.name,
        courses: s.courses,
        credits: s.rows.reduce((sum, r) => sum + r.creditsEarned, 0),
        gpa: gpaOf(s.rows),
      })),
    creditsAttempted: kept.reduce((s, r) => s + r.creditsAttempted, 0),
    creditsEarned: kept.reduce((s, r) => s + r.creditsEarned, 0),
    cgpa: gpaOf(kept),
    generatedAt: new Date().toISOString(),
  };
}

export async function myTranscript(actor: ActorContext) {
  const student = await prisma.student.findUnique({
    where: { userId: actor.userId },
    select: { id: true },
  });
  if (!student) throw new NotFoundError('Student');
  return buildTranscript(student.id);
}

/** Administrators with `record:read` over the student's department. */
export async function studentTranscript(actor: ActorContext, studentId: string) {
  const s = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      program: { select: { departmentId: true, department: { select: { schoolId: true } } } },
    },
  });
  if (
    !s ||
    !covers(actor.grants, 'record:read', {
      departmentId: s.program.departmentId,
      schoolId: s.program.department.schoolId,
    })
  )
    throw new NotFoundError('Student');
  return buildTranscript(studentId);
}
