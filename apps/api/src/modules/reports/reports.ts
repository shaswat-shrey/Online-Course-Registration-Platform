import type { PermissionKey } from '@ucrams/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext } from '../../common/context/actor.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { scopeFilter } from '../authz/authz.js';

export interface ReportFilters {
  sessionId?: string;
  schoolId?: string;
  departmentId?: string;
  programId?: string;
  courseId?: string;
  status?: string;
  q?: string;
}
export type FilterKey = keyof ReportFilters;
export type Row = Record<string, string | number | null>;

export interface ReportColumn {
  key: string;
  label: string;
  type?: 'number' | 'percent' | 'text' | 'date';
}

interface Ctx {
  f: ReportFilters;
  /** Departments in scope; null when unrestricted. */
  depts: string[] | null;
  /** Session the report is about (defaults to the running session). */
  sessionId: string | null;
}

export interface ReportDefinition {
  key: string;
  title: string;
  description: string;
  filters: FilterKey[];
  /** Status filter choices, when the report has one. */
  statuses?: string[];
  columns: ReportColumn[];
  defaultSort: string;
  run: (ctx: Ctx) => Promise<Row[]>;
}

const pct = (part: number, whole: number) =>
  whole ? Math.round((part / whole) * 1000) / 10 : null;
const num = (d: { toNumber(): number } | number | null | undefined) =>
  d === null || d === undefined ? null : typeof d === 'number' ? d : d.toNumber();
const like = (q?: string) => (q ? { contains: q, mode: 'insensitive' as const } : undefined);
const SEAT = ['PENDING', 'REGISTERED', 'OFFERED'] as const;

function deptFilter(ctx: Ctx): { in: string[] } | undefined {
  return ctx.depts ? { in: ctx.depts } : undefined;
}
function courseWhere(ctx: Ctx): Prisma.CourseWhereInput {
  const d = deptFilter(ctx);
  return { ...(d ? { departmentId: d } : {}), ...(ctx.f.courseId ? { id: ctx.f.courseId } : {}) };
}
function sectionWhere(ctx: Ctx): Prisma.CourseSectionWhereInput {
  return {
    ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
    status: { not: 'CANCELLED' },
    course: courseWhere(ctx),
  };
}
function studentWhere(ctx: Ctx): Prisma.StudentWhereInput {
  const d = deptFilter(ctx);
  return {
    program: {
      ...(d ? { departmentId: d } : {}),
      ...(ctx.f.programId ? { id: ctx.f.programId } : {}),
    },
  };
}

/** The report catalogue (FR-RPT-001). Every query respects `ctx.depts` (FR-RPT-002). */
export const REPORTS: ReportDefinition[] = [
  {
    key: 'students',
    title: 'Students',
    description: 'Students with programme, year and status.',
    filters: ['schoolId', 'departmentId', 'programId', 'status', 'q'],
    statuses: ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN', 'DISMISSED'],
    defaultSort: 'name:asc',
    columns: [
      { key: 'studentNumber', label: 'Student number' },
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'program', label: 'Programme' },
      { key: 'department', label: 'Department' },
      { key: 'year', label: 'Year', type: 'number' },
      { key: 'status', label: 'Status' },
    ],
    run: async (ctx) => {
      const rows = await prisma.student.findMany({
        where: {
          ...studentWhere(ctx),
          ...(ctx.f.status ? { status: ctx.f.status as never } : {}),
          ...(ctx.f.q
            ? {
                OR: [
                  { studentNumber: like(ctx.f.q) },
                  { user: { firstName: like(ctx.f.q) } },
                  { user: { lastName: like(ctx.f.q) } },
                  { user: { email: like(ctx.f.q) } },
                ],
              }
            : {}),
        },
        select: {
          studentNumber: true,
          yearOfStudy: true,
          status: true,
          user: { select: { firstName: true, lastName: true, email: true } },
          program: { select: { code: true, department: { select: { code: true } } } },
        },
      });
      return rows.map((s) => ({
        studentNumber: s.studentNumber,
        name: `${s.user.firstName} ${s.user.lastName}`,
        email: s.user.email,
        program: s.program.code,
        department: s.program.department.code,
        year: s.yearOfStudy,
        status: s.status,
      }));
    },
  },
  {
    key: 'faculty',
    title: 'Faculty',
    description: 'Faculty members with department, designation and status.',
    filters: ['schoolId', 'departmentId', 'status', 'q'],
    statuses: ['ACTIVE', 'ON_LEAVE', 'INACTIVE'],
    defaultSort: 'name:asc',
    columns: [
      { key: 'employeeNumber', label: 'Employee number' },
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'department', label: 'Department' },
      { key: 'designation', label: 'Designation' },
      { key: 'status', label: 'Status' },
    ],
    run: async (ctx) => {
      const d = deptFilter(ctx);
      const rows = await prisma.facultyMember.findMany({
        where: {
          ...(d ? { departmentId: d } : {}),
          ...(ctx.f.status ? { employmentStatus: ctx.f.status as never } : {}),
          ...(ctx.f.q
            ? {
                OR: [
                  { employeeNumber: like(ctx.f.q) },
                  { user: { firstName: like(ctx.f.q) } },
                  { user: { lastName: like(ctx.f.q) } },
                ],
              }
            : {}),
        },
        select: {
          employeeNumber: true,
          designation: true,
          employmentStatus: true,
          user: { select: { firstName: true, lastName: true, email: true } },
          department: { select: { code: true } },
        },
      });
      return rows.map((f) => ({
        employeeNumber: f.employeeNumber,
        name: `${f.user.firstName} ${f.user.lastName}`,
        email: f.user.email,
        department: f.department.code,
        designation: f.designation,
        status: f.employmentStatus,
      }));
    },
  },
  {
    key: 'departments',
    title: 'Departments',
    description: 'Departments with programme, faculty and student counts.',
    filters: ['schoolId', 'departmentId', 'q'],
    defaultSort: 'code:asc',
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Department' },
      { key: 'school', label: 'School' },
      { key: 'programs', label: 'Programmes', type: 'number' },
      { key: 'faculty', label: 'Faculty', type: 'number' },
      { key: 'students', label: 'Students', type: 'number' },
      { key: 'courses', label: 'Courses', type: 'number' },
    ],
    run: async (ctx) => {
      const d = deptFilter(ctx);
      const rows = await prisma.department.findMany({
        where: { ...(d ? { id: d } : {}), ...(ctx.f.q ? { name: like(ctx.f.q) } : {}) },
        select: {
          code: true,
          name: true,
          school: { select: { name: true } },
          _count: { select: { programs: true, facultyMembers: true, courses: true } },
          programs: { select: { _count: { select: { students: true } } } },
        },
      });
      return rows.map((r) => ({
        code: r.code,
        name: r.name,
        school: r.school.name,
        programs: r._count.programs,
        faculty: r._count.facultyMembers,
        students: r.programs.reduce((s, p) => s + p._count.students, 0),
        courses: r._count.courses,
      }));
    },
  },
  {
    key: 'programs',
    title: 'Programmes',
    description: 'Programmes with total credits and enrolled students.',
    filters: ['schoolId', 'departmentId', 'programId', 'q'],
    defaultSort: 'code:asc',
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Programme' },
      { key: 'department', label: 'Department' },
      { key: 'degree', label: 'Degree' },
      { key: 'credits', label: 'Credits', type: 'number' },
      { key: 'students', label: 'Students', type: 'number' },
      { key: 'specializations', label: 'Specializations', type: 'number' },
    ],
    run: async (ctx) => {
      const d = deptFilter(ctx);
      const rows = await prisma.program.findMany({
        where: {
          ...(d ? { departmentId: d } : {}),
          ...(ctx.f.programId ? { id: ctx.f.programId } : {}),
          ...(ctx.f.q ? { OR: [{ name: like(ctx.f.q) }, { code: like(ctx.f.q) }] } : {}),
        },
        select: {
          code: true,
          name: true,
          totalCredits: true,
          department: { select: { code: true } },
          degree: { select: { code: true } },
          _count: { select: { students: true, specializations: true } },
        },
      });
      return rows.map((p) => ({
        code: p.code,
        name: p.name,
        department: p.department.code,
        degree: p.degree.code,
        credits: num(p.totalCredits),
        students: p._count.students,
        specializations: p._count.specializations,
      }));
    },
  },
  {
    key: 'specializations',
    title: 'Specializations',
    description: 'Specializations with their programme and students.',
    filters: ['schoolId', 'departmentId', 'programId', 'q'],
    defaultSort: 'name:asc',
    columns: [
      { key: 'name', label: 'Specialization' },
      { key: 'program', label: 'Programme' },
      { key: 'department', label: 'Department' },
      { key: 'students', label: 'Students', type: 'number' },
    ],
    run: async (ctx) => {
      const d = deptFilter(ctx);
      const rows = await prisma.specialization.findMany({
        where: {
          program: {
            ...(d ? { departmentId: d } : {}),
            ...(ctx.f.programId ? { id: ctx.f.programId } : {}),
          },
          ...(ctx.f.q ? { name: like(ctx.f.q) } : {}),
        },
        select: {
          name: true,
          program: { select: { code: true, department: { select: { code: true } } } },
          _count: { select: { students: true } },
        },
      });
      return rows.map((s) => ({
        name: s.name,
        program: s.program.code,
        department: s.program.department.code,
        students: s._count.students,
      }));
    },
  },
  {
    key: 'course-enrollment',
    title: 'Course enrollment',
    description: 'Seats, enrollment and waitlists per course in a session.',
    filters: ['sessionId', 'schoolId', 'departmentId', 'courseId', 'q'],
    defaultSort: 'enrolled:desc',
    columns: [
      { key: 'code', label: 'Course' },
      { key: 'title', label: 'Title' },
      { key: 'department', label: 'Department' },
      { key: 'sections', label: 'Sections', type: 'number' },
      { key: 'capacity', label: 'Capacity', type: 'number' },
      { key: 'enrolled', label: 'Enrolled', type: 'number' },
      { key: 'waitlisted', label: 'Waitlisted', type: 'number' },
      { key: 'fill', label: 'Fill', type: 'percent' },
    ],
    run: async (ctx) => {
      const sections = await prisma.courseSection.findMany({
        where: {
          ...sectionWhere(ctx),
          ...(ctx.f.q
            ? {
                course: {
                  ...courseWhere(ctx),
                  OR: [{ code: like(ctx.f.q) }, { title: like(ctx.f.q) }],
                },
              }
            : {}),
        },
        select: {
          capacity: true,
          enrolledCount: true,
          waitlistCount: true,
          course: {
            select: { id: true, code: true, title: true, department: { select: { code: true } } },
          },
        },
      });
      const by = new Map<string, Row & { capacity: number; enrolled: number }>();
      for (const s of sections) {
        const r =
          by.get(s.course.id) ??
          ({
            code: s.course.code,
            title: s.course.title,
            department: s.course.department.code,
            sections: 0,
            capacity: 0,
            enrolled: 0,
            waitlisted: 0,
            fill: null,
          } as Row & { capacity: number; enrolled: number });
        r.sections = (r.sections as number) + 1;
        r.capacity += s.capacity;
        r.enrolled += s.enrolledCount;
        r.waitlisted = (r.waitlisted as number) + s.waitlistCount;
        by.set(s.course.id, r);
      }
      return [...by.values()].map((r) => ({ ...r, fill: pct(r.enrolled, r.capacity) }));
    },
  },
  {
    key: 'section-enrollment',
    title: 'Section enrollment',
    description: 'Every section with instructor, seats, enrollment and waitlist.',
    filters: ['sessionId', 'schoolId', 'departmentId', 'courseId', 'status', 'q'],
    statuses: ['DRAFT', 'PUBLISHED', 'CLOSED', 'COMPLETED'],
    defaultSort: 'section:asc',
    columns: [
      { key: 'section', label: 'Section' },
      { key: 'title', label: 'Title' },
      { key: 'instructor', label: 'Instructor' },
      { key: 'status', label: 'Status' },
      { key: 'capacity', label: 'Capacity', type: 'number' },
      { key: 'enrolled', label: 'Enrolled', type: 'number' },
      { key: 'waitlisted', label: 'Waitlisted', type: 'number' },
      { key: 'fill', label: 'Fill', type: 'percent' },
    ],
    run: async (ctx) => {
      const rows = await prisma.courseSection.findMany({
        where: {
          ...sectionWhere(ctx),
          ...(ctx.f.status ? { status: ctx.f.status as never } : {}),
          ...(ctx.f.q
            ? {
                course: {
                  ...courseWhere(ctx),
                  OR: [{ code: like(ctx.f.q) }, { title: like(ctx.f.q) }],
                },
              }
            : {}),
        },
        select: {
          sectionCode: true,
          status: true,
          capacity: true,
          enrolledCount: true,
          waitlistCount: true,
          course: { select: { code: true, title: true } },
          instructors: {
            where: { role: 'PRIMARY' },
            select: {
              facultyMember: { select: { user: { select: { firstName: true, lastName: true } } } },
            },
          },
        },
      });
      return rows.map((s) => {
        const i = s.instructors[0]?.facultyMember.user;
        return {
          section: `${s.course.code} ${s.sectionCode}`,
          title: s.course.title,
          instructor: i ? `${i.firstName} ${i.lastName}` : 'TBA',
          status: s.status,
          capacity: s.capacity,
          enrolled: s.enrolledCount,
          waitlisted: s.waitlistCount,
          fill: pct(s.enrolledCount, s.capacity),
        };
      });
    },
  },
  {
    key: 'registrations',
    title: 'Registrations',
    description: 'Every registration in a session with its status.',
    filters: ['sessionId', 'schoolId', 'departmentId', 'programId', 'courseId', 'status', 'q'],
    statuses: [
      'PENDING',
      'REGISTERED',
      'WAITLISTED',
      'OFFERED',
      'DROPPED',
      'WITHDRAWN',
      'REJECTED',
      'CANCELLED',
      'EXPIRED',
      'COMPLETED',
    ],
    defaultSort: 'registeredAt:desc',
    columns: [
      { key: 'studentNumber', label: 'Student number' },
      { key: 'student', label: 'Student' },
      { key: 'section', label: 'Section' },
      { key: 'credits', label: 'Credits', type: 'number' },
      { key: 'status', label: 'Status' },
      { key: 'registeredAt', label: 'Created', type: 'date' },
    ],
    run: async (ctx) => {
      const rows = await prisma.courseRegistration.findMany({
        where: {
          ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
          course: courseWhere(ctx),
          ...(ctx.f.programId ? { student: studentWhere(ctx) } : {}),
          ...(ctx.f.status ? { status: ctx.f.status as never } : {}),
          ...(ctx.f.q
            ? {
                OR: [
                  { student: { studentNumber: like(ctx.f.q) } },
                  { student: { user: { lastName: like(ctx.f.q) } } },
                  { course: { code: like(ctx.f.q) } },
                ],
              }
            : {}),
        },
        select: {
          status: true,
          credits: true,
          createdAt: true,
          student: {
            select: { studentNumber: true, user: { select: { firstName: true, lastName: true } } },
          },
          section: { select: { sectionCode: true, course: { select: { code: true } } } },
        },
      });
      return rows.map((r) => ({
        studentNumber: r.student.studentNumber,
        student: `${r.student.user.firstName} ${r.student.user.lastName}`,
        section: `${r.section.course.code} ${r.section.sectionCode}`,
        credits: num(r.credits),
        status: r.status,
        registeredAt: r.createdAt.toISOString(),
      }));
    },
  },
  {
    key: 'capacity',
    title: 'Capacity',
    description: 'Seats and utilisation per department in a session.',
    filters: ['sessionId', 'schoolId', 'departmentId'],
    defaultSort: 'utilization:desc',
    columns: [
      { key: 'department', label: 'Department' },
      { key: 'sections', label: 'Sections', type: 'number' },
      { key: 'capacity', label: 'Capacity', type: 'number' },
      { key: 'enrolled', label: 'Enrolled', type: 'number' },
      { key: 'available', label: 'Available', type: 'number' },
      { key: 'full', label: 'Full sections', type: 'number' },
      { key: 'utilization', label: 'Utilisation', type: 'percent' },
    ],
    run: async (ctx) => {
      const sections = await prisma.courseSection.findMany({
        where: { ...sectionWhere(ctx), status: { in: ['PUBLISHED', 'CLOSED'] } },
        select: {
          capacity: true,
          enrolledCount: true,
          course: { select: { department: { select: { code: true } } } },
        },
      });
      const by = new Map<
        string,
        { sections: number; capacity: number; enrolled: number; full: number }
      >();
      for (const s of sections) {
        const k = s.course.department.code;
        const r = by.get(k) ?? { sections: 0, capacity: 0, enrolled: 0, full: 0 };
        r.sections++;
        r.capacity += s.capacity;
        r.enrolled += s.enrolledCount;
        if (s.enrolledCount >= s.capacity) r.full++;
        by.set(k, r);
      }
      return [...by].map(([department, r]) => ({
        department,
        ...r,
        available: Math.max(0, r.capacity - r.enrolled),
        utilization: pct(r.enrolled, r.capacity),
      }));
    },
  },
  {
    key: 'faculty-workload',
    title: 'Faculty workload',
    description: 'Sections, credits and students taught per faculty member in a session.',
    filters: ['sessionId', 'schoolId', 'departmentId', 'q'],
    defaultSort: 'credits:desc',
    columns: [
      { key: 'name', label: 'Faculty member' },
      { key: 'department', label: 'Department' },
      { key: 'sections', label: 'Sections', type: 'number' },
      { key: 'credits', label: 'Credits', type: 'number' },
      { key: 'maxLoad', label: 'Max load', type: 'number' },
      { key: 'students', label: 'Students', type: 'number' },
    ],
    run: async (ctx) => {
      const d = deptFilter(ctx);
      const members = await prisma.facultyMember.findMany({
        where: {
          ...(d ? { departmentId: d } : {}),
          employmentStatus: 'ACTIVE',
          ...(ctx.f.q
            ? {
                OR: [{ user: { firstName: like(ctx.f.q) } }, { user: { lastName: like(ctx.f.q) } }],
              }
            : {}),
        },
        select: {
          maxLoadCredits: true,
          user: { select: { firstName: true, lastName: true } },
          department: { select: { code: true } },
          sectionAssignments: {
            where: {
              section: {
                ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
                status: { not: 'CANCELLED' },
              },
            },
            select: {
              section: { select: { enrolledCount: true, course: { select: { credits: true } } } },
            },
          },
        },
      });
      return members.map((m) => ({
        name: `${m.user.firstName} ${m.user.lastName}`,
        department: m.department.code,
        sections: m.sectionAssignments.length,
        credits: m.sectionAssignments.reduce((s, a) => s + (num(a.section.course.credits) ?? 0), 0),
        maxLoad: num(m.maxLoadCredits),
        students: m.sectionAssignments.reduce((s, a) => s + a.section.enrolledCount, 0),
      }));
    },
  },
  {
    key: 'grade-distribution',
    title: 'Academic performance',
    description: 'Grade distribution per course in a session.',
    filters: ['sessionId', 'schoolId', 'departmentId', 'courseId', 'q'],
    defaultSort: 'course:asc',
    columns: [
      { key: 'course', label: 'Course' },
      { key: 'grade', label: 'Grade' },
      { key: 'students', label: 'Students', type: 'number' },
      { key: 'share', label: 'Share of course', type: 'percent' },
    ],
    run: async (ctx) => {
      const records = await prisma.academicRecord.findMany({
        where: {
          ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
          course: courseWhere(ctx),
          ...(ctx.f.q ? { courseCodeSnapshot: like(ctx.f.q) } : {}),
        },
        select: { courseCodeSnapshot: true, gradeLetter: true },
      });
      const totals = new Map<string, number>();
      const by = new Map<string, number>();
      for (const r of records) {
        totals.set(r.courseCodeSnapshot, (totals.get(r.courseCodeSnapshot) ?? 0) + 1);
        const k = `${r.courseCodeSnapshot}|${r.gradeLetter ?? '—'}`;
        by.set(k, (by.get(k) ?? 0) + 1);
      }
      return [...by].map(([k, n]) => {
        const [course, grade] = k.split('|');
        return { course: course!, grade: grade!, students: n, share: pct(n, totals.get(course!)!) };
      });
    },
  },
  {
    key: 'course-completion',
    title: 'Course completion',
    description: 'Attempts, passes, failures and withdrawals per course in a session.',
    filters: ['sessionId', 'schoolId', 'departmentId', 'courseId', 'q'],
    defaultSort: 'passRate:asc',
    columns: [
      { key: 'course', label: 'Course' },
      { key: 'title', label: 'Title' },
      { key: 'completed', label: 'Completed', type: 'number' },
      { key: 'passed', label: 'Passed', type: 'number' },
      { key: 'failed', label: 'Failed', type: 'number' },
      { key: 'withdrawn', label: 'Withdrawn', type: 'number' },
      { key: 'passRate', label: 'Pass rate', type: 'percent' },
    ],
    run: async (ctx) => {
      const [records, withdrawn] = await Promise.all([
        prisma.academicRecord.findMany({
          where: {
            ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
            course: courseWhere(ctx),
            ...(ctx.f.q ? { courseCodeSnapshot: like(ctx.f.q) } : {}),
          },
          select: { courseCodeSnapshot: true, courseTitleSnapshot: true, passed: true },
        }),
        prisma.courseRegistration.groupBy({
          by: ['courseId'],
          where: {
            ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
            status: 'WITHDRAWN',
            course: courseWhere(ctx),
          },
          _count: { _all: true },
        }),
      ]);
      const codes = await prisma.course.findMany({
        where: { id: { in: withdrawn.map((w) => w.courseId) } },
        select: { id: true, code: true },
      });
      const wByCode = new Map(
        withdrawn.map((w) => [codes.find((c) => c.id === w.courseId)?.code ?? '', w._count._all]),
      );
      const by = new Map<string, { title: string; passed: number; failed: number }>();
      for (const r of records) {
        const x = by.get(r.courseCodeSnapshot) ?? {
          title: r.courseTitleSnapshot,
          passed: 0,
          failed: 0,
        };
        if (r.passed) x.passed++;
        else x.failed++;
        by.set(r.courseCodeSnapshot, x);
      }
      return [...by].map(([course, x]) => ({
        course,
        title: x.title,
        completed: x.passed + x.failed,
        passed: x.passed,
        failed: x.failed,
        withdrawn: wByCode.get(course) ?? 0,
        passRate: pct(x.passed, x.passed + x.failed),
      }));
    },
  },
  {
    key: 'student-credits',
    title: 'Student credits',
    description: 'Credits registered in a session and earned overall, per student.',
    filters: ['sessionId', 'schoolId', 'departmentId', 'programId', 'q'],
    defaultSort: 'registered:desc',
    columns: [
      { key: 'studentNumber', label: 'Student number' },
      { key: 'name', label: 'Name' },
      { key: 'program', label: 'Programme' },
      { key: 'year', label: 'Year', type: 'number' },
      { key: 'registered', label: 'Registered (session)', type: 'number' },
      { key: 'earned', label: 'Earned (total)', type: 'number' },
      { key: 'required', label: 'Programme total', type: 'number' },
    ],
    run: async (ctx) => {
      const students = await prisma.student.findMany({
        where: {
          ...studentWhere(ctx),
          status: 'ACTIVE',
          ...(ctx.f.q
            ? { OR: [{ studentNumber: like(ctx.f.q) }, { user: { lastName: like(ctx.f.q) } }] }
            : {}),
        },
        select: {
          studentNumber: true,
          yearOfStudy: true,
          user: { select: { firstName: true, lastName: true } },
          program: { select: { code: true, totalCredits: true } },
          registrations: {
            where: {
              ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
              status: { in: [...SEAT] },
            },
            select: { credits: true },
          },
          academicRecords: { select: { creditsEarned: true } },
        },
      });
      return students.map((s) => ({
        studentNumber: s.studentNumber,
        name: `${s.user.firstName} ${s.user.lastName}`,
        program: s.program.code,
        year: s.yearOfStudy,
        registered: s.registrations.reduce((t, r) => t + (num(r.credits) ?? 0), 0),
        earned: s.academicRecords.reduce((t, r) => t + (num(r.creditsEarned) ?? 0), 0),
        required: num(s.program.totalCredits),
      }));
    },
  },
  {
    key: 'enrollment-trends',
    title: 'Enrollment trends',
    description: 'Registrations, students and credits per session over time.',
    filters: ['schoolId', 'departmentId', 'courseId'],
    defaultSort: 'start:asc',
    columns: [
      { key: 'session', label: 'Session' },
      { key: 'start', label: 'Starts', type: 'date' },
      { key: 'registrations', label: 'Registrations', type: 'number' },
      { key: 'students', label: 'Students', type: 'number' },
      { key: 'credits', label: 'Credits', type: 'number' },
      { key: 'dropped', label: 'Dropped / withdrawn', type: 'number' },
    ],
    run: async (ctx) => {
      const sessions = await prisma.academicSession.findMany({
        select: { id: true, name: true, startDate: true },
      });
      const regs = await prisma.courseRegistration.findMany({
        where: { course: courseWhere(ctx) },
        select: { sessionId: true, studentId: true, status: true, credits: true },
      });
      return sessions.map((s) => {
        const mine = regs.filter((r) => r.sessionId === s.id);
        const enrolled = mine.filter((r) =>
          ['PENDING', 'REGISTERED', 'OFFERED', 'COMPLETED'].includes(r.status),
        );
        return {
          session: s.name,
          start: s.startDate.toISOString().slice(0, 10),
          registrations: enrolled.length,
          students: new Set(enrolled.map((r) => r.studentId)).size,
          credits: enrolled.reduce((t, r) => t + (num(r.credits) ?? 0), 0),
          dropped: mine.filter((r) => r.status === 'DROPPED' || r.status === 'WITHDRAWN').length,
        };
      });
    },
  },
  {
    key: 'incomplete-registrations',
    title: 'Incomplete registrations',
    description: 'Active students below the session minimum credits or with pending items.',
    filters: ['sessionId', 'schoolId', 'departmentId', 'programId', 'q'],
    defaultSort: 'registered:asc',
    columns: [
      { key: 'studentNumber', label: 'Student number' },
      { key: 'name', label: 'Name' },
      { key: 'program', label: 'Programme' },
      { key: 'registered', label: 'Credits', type: 'number' },
      { key: 'minimum', label: 'Minimum', type: 'number' },
      { key: 'pending', label: 'Pending approvals', type: 'number' },
      { key: 'waitlisted', label: 'Waitlisted', type: 'number' },
      { key: 'reason', label: 'Reason' },
    ],
    run: async (ctx) => {
      if (!ctx.sessionId) return [];
      const policy = await prisma.sessionPolicy.findUnique({ where: { sessionId: ctx.sessionId } });
      const minimum = num(policy?.minCredits) ?? 0;
      const students = await prisma.student.findMany({
        where: {
          ...studentWhere(ctx),
          status: 'ACTIVE',
          ...(ctx.f.q
            ? { OR: [{ studentNumber: like(ctx.f.q) }, { user: { lastName: like(ctx.f.q) } }] }
            : {}),
        },
        select: {
          studentNumber: true,
          user: { select: { firstName: true, lastName: true } },
          program: { select: { code: true } },
          registrations: {
            where: {
              sessionId: ctx.sessionId,
              status: { in: ['PENDING', 'REGISTERED', 'OFFERED', 'WAITLISTED'] },
            },
            select: { status: true, credits: true },
          },
        },
      });
      return students
        .map((s) => {
          const registered = s.registrations
            .filter((r) => r.status !== 'WAITLISTED')
            .reduce((t, r) => t + (num(r.credits) ?? 0), 0);
          const pending = s.registrations.filter((r) => r.status === 'PENDING').length;
          const waitlisted = s.registrations.filter((r) => r.status === 'WAITLISTED').length;
          const reasons = [
            registered < minimum ? 'Below minimum credits' : null,
            pending ? 'Awaiting approval' : null,
            waitlisted ? 'On a waitlist' : null,
          ].filter(Boolean);
          return {
            studentNumber: s.studentNumber,
            name: `${s.user.firstName} ${s.user.lastName}`,
            program: s.program.code,
            registered,
            minimum,
            pending,
            waitlisted,
            reason: reasons.join('; '),
          };
        })
        .filter((r) => r.reason);
    },
  },
];

export const reportByKey = new Map(REPORTS.map((r) => [r.key, r]));

/** Departments the caller may report on, narrowed by school/department filters. */
export async function scopedDepartments(
  actor: ActorContext,
  permission: PermissionKey,
  f: ReportFilters,
): Promise<string[] | null> {
  const scope = scopeFilter(actor.grants, permission);
  if (!scope && !f.schoolId && !f.departmentId) return null;
  const rows = await prisma.department.findMany({
    where: {
      AND: [
        scope
          ? { OR: [{ id: { in: scope.departmentIds } }, { schoolId: { in: scope.schoolIds } }] }
          : {},
        f.schoolId ? { schoolId: f.schoolId } : {},
        f.departmentId ? { id: f.departmentId } : {},
      ],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Runs a report for the caller and returns every row (sorted), ready to page or export. */
export async function runReport(
  actor: ActorContext,
  report: ReportDefinition,
  f: ReportFilters,
  sort: string | undefined,
) {
  const clean: ReportFilters = {};
  for (const k of report.filters) if (f[k]) clean[k] = f[k] as never;
  const depts = await scopedDepartments(actor, 'report:read', clean);
  let sessionId = clean.sessionId ?? null;
  if (!sessionId && report.filters.includes('sessionId')) {
    const current = await prisma.academicSession.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { startDate: 'desc' },
      select: { id: true },
    });
    sessionId = current?.id ?? null;
  }
  const rows = await report.run({ f: clean, depts, sessionId });
  const [field, dir] = (sort ?? report.defaultSort).split(':');
  const key = report.columns.some((c) => c.key === field)
    ? field!
    : report.defaultSort.split(':')[0]!;
  const factor = dir === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x === y) return 0;
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return (
      (typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y))) * factor
    );
  });
  return { rows, sessionId, sort: `${key}:${dir === 'desc' ? 'desc' : 'asc'}` };
}
