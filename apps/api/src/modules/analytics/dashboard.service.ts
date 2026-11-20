import { createHash } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext } from '../../common/context/actor.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { getQueue, QueueName } from '../../infrastructure/queues/queues.js';
import { redis } from '../../infrastructure/redis/redis.js';
import { hasGlobal, hasPermission, scopeFilter } from '../authz/authz.js';

export interface DashboardFilters {
  academicYearId?: string;
  sessionId?: string;
  schoolId?: string;
  departmentId?: string;
  degreeId?: string;
  programId?: string;
  specializationId?: string;
  courseId?: string;
}

const CACHE_SECONDS = 60;
const VERSION_KEY = 'dash:version';
const HEARTBEAT_KEY = 'worker:heartbeat';
const SEAT = ['PENDING', 'REGISTERED', 'OFFERED'] as const;
const ENROLLED = ['PENDING', 'REGISTERED', 'OFFERED', 'COMPLETED'] as const;

/** Registration writes bump the cache version so dashboards never serve stale counts (FR-ADMIN-005). */
export function invalidateDashboards() {
  redis
    .incr(VERSION_KEY)
    .catch((err: Error) =>
      logger.warn({ err: err.message }, 'Could not invalidate dashboard cache'),
    );
}

/**
 * The departments a dashboard covers: the caller's `dashboard:admin` scope
 * (FR-ADMIN-006) narrowed by the school/department filters. Null = everything.
 */
async function departmentSet(actor: ActorContext, f: DashboardFilters) {
  const scope = scopeFilter(actor.grants, 'dashboard:admin');
  if (!scope && !f.schoolId && !f.departmentId) return null;
  const rows = await prisma.department.findMany({
    where: {
      AND: [
        scope
          ? {
              OR: [{ id: { in: scope.departmentIds } }, { schoolId: { in: scope.schoolIds } }],
            }
          : {},
        f.schoolId ? { schoolId: f.schoolId } : {},
        f.departmentId ? { id: f.departmentId } : {},
      ],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function sessionSet(f: DashboardFilters) {
  if (f.sessionId) return [f.sessionId];
  const rows = await prisma.academicSession.findMany({
    where: f.academicYearId ? { academicYearId: f.academicYearId } : { status: 'ACTIVE' },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

async function compute(actor: ActorContext, f: DashboardFilters) {
  const depts = await departmentSet(actor, f);
  const sessions = await sessionSet(f);
  const inDepts = depts ? { in: depts } : undefined;

  const studentWhere: Prisma.StudentWhereInput = {
    program: {
      ...(inDepts ? { departmentId: inDepts } : {}),
      ...(f.degreeId ? { degreeId: f.degreeId } : {}),
      ...(f.programId ? { id: f.programId } : {}),
    },
    ...(f.specializationId ? { specializationId: f.specializationId } : {}),
  };
  const programFiltered = !!(f.degreeId || f.programId || f.specializationId);
  const courseWhere: Prisma.CourseWhereInput = {
    ...(inDepts ? { departmentId: inDepts } : {}),
    ...(f.courseId ? { id: f.courseId } : {}),
  };
  const sectionWhere: Prisma.CourseSectionWhereInput = {
    sessionId: { in: sessions },
    status: { notIn: ['CANCELLED', 'DRAFT'] },
    course: courseWhere,
  };
  const regWhere: Prisma.CourseRegistrationWhereInput = {
    sessionId: { in: sessions },
    course: courseWhere,
    ...(programFiltered ? { student: studentWhere } : {}),
  };
  const deptWhere: Prisma.DepartmentWhereInput = inDepts ? { id: inDepts } : {};

  const [
    studentsTotal,
    studentsActive,
    faculty,
    admins,
    schools,
    departments,
    programs,
    specializations,
    courses,
    sections,
    registrations,
    activeSessions,
    pendingRegistrations,
    seatSections,
  ] = await Promise.all([
    prisma.student.count({ where: studentWhere }),
    prisma.student.count({ where: { ...studentWhere, status: 'ACTIVE' } }),
    prisma.facultyMember.count({
      where: { employmentStatus: 'ACTIVE', ...(inDepts ? { departmentId: inDepts } : {}) },
    }),
    prisma.user.count({
      where: {
        status: 'ACTIVE',
        roles: {
          some: {
            role: { scopeMode: 'ORGANIZATIONAL' },
            ...(depts
              ? {
                  OR: [
                    { scopeType: 'DEPARTMENT', scopeId: { in: depts } },
                    {
                      scopeType: 'SCHOOL',
                      scopeId: {
                        in: (
                          await prisma.department.findMany({
                            where: { id: { in: depts } },
                            select: { schoolId: true },
                          })
                        ).map((d) => d.schoolId),
                      },
                    },
                  ],
                }
              : {}),
          },
        },
      },
    }),
    prisma.school.count({ where: depts ? { departments: { some: { id: inDepts } } } : {} }),
    prisma.department.count({ where: deptWhere }),
    prisma.program.count({ where: inDepts ? { departmentId: inDepts } : {} }),
    prisma.specialization.count({ where: inDepts ? { program: { departmentId: inDepts } } : {} }),
    prisma.course.count({ where: { ...courseWhere, status: 'ACTIVE' } }),
    prisma.courseSection.count({ where: sectionWhere }),
    prisma.courseRegistration.count({ where: { ...regWhere, status: { in: [...SEAT] } } }),
    prisma.academicSession.count({ where: { status: 'ACTIVE' } }),
    prisma.courseRegistration.count({ where: { ...regWhere, status: 'PENDING' } }),
    prisma.courseSection.findMany({
      where: { ...sectionWhere, status: { in: ['PUBLISHED', 'CLOSED'] } },
      select: {
        id: true,
        sectionCode: true,
        capacity: true,
        enrolledCount: true,
        course: {
          select: {
            code: true,
            minEnrollment: true,
            department: { select: { id: true, code: true } },
          },
        },
        instructors: { where: { role: 'PRIMARY' }, select: { facultyMemberId: true } },
      },
    }),
  ]);
  const capacity = seatSections.reduce((s, x) => s + x.capacity, 0);
  const enrolled = seatSections.reduce((s, x) => s + x.enrolledCount, 0);

  // ----- charts (FR-ADMIN-002) -----
  const trendSessions = await prisma.academicSession.findMany({
    orderBy: { startDate: 'desc' },
    take: 6,
    select: { id: true, name: true },
  });
  const [trendCounts, programCounts, facultyCounts, topCourseGroups, statusGroups] =
    await Promise.all([
      prisma.courseRegistration.groupBy({
        by: ['sessionId'],
        where: {
          sessionId: { in: trendSessions.map((s) => s.id) },
          status: { in: [...ENROLLED] },
          course: courseWhere,
          ...(programFiltered ? { student: studentWhere } : {}),
        },
        _count: { _all: true },
      }),
      prisma.program.findMany({
        where: {
          ...(inDepts ? { departmentId: inDepts } : {}),
          ...(f.degreeId ? { degreeId: f.degreeId } : {}),
          ...(f.programId ? { id: f.programId } : {}),
        },
        select: {
          code: true,
          name: true,
          department: { select: { code: true, school: { select: { code: true, name: true } } } },
          _count: {
            select: {
              students: {
                where: f.specializationId ? { specializationId: f.specializationId } : {},
              },
            },
          },
        },
      }),
      prisma.department.findMany({
        where: deptWhere,
        select: {
          code: true,
          _count: { select: { facultyMembers: { where: { employmentStatus: 'ACTIVE' } } } },
        },
      }),
      prisma.courseRegistration.groupBy({
        by: ['courseId'],
        where: { ...regWhere, status: { in: [...ENROLLED] } },
        _count: { _all: true },
        orderBy: { _count: { courseId: 'desc' } },
        take: 10,
      }),
      prisma.courseRegistration.groupBy({
        by: ['status'],
        where: regWhere,
        _count: { _all: true },
      }),
    ]);
  const topCourseRows = await prisma.course.findMany({
    where: { id: { in: topCourseGroups.map((g) => g.courseId) } },
    select: { id: true, code: true, title: true },
  });
  const sum = <T>(rows: T[], key: (r: T) => string, value: (r: T) => number) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + value(r));
    return [...m].map(([label, v]) => ({ label, value: v })).sort((a, b) => b.value - a.value);
  };
  const utilization = new Map<string, { capacity: number; enrolled: number }>();
  for (const s of seatSections) {
    const u = utilization.get(s.course.department.code) ?? { capacity: 0, enrolled: 0 };
    u.capacity += s.capacity;
    u.enrolled += s.enrolledCount;
    utilization.set(s.course.department.code, u);
  }

  // ----- widgets and alerts (FR-ADMIN-004) -----
  const userScope: Prisma.UserWhereInput = depts
    ? {
        OR: [
          { student: { program: { departmentId: inDepts } } },
          { facultyMember: { departmentId: inDepts } },
        ],
      }
    : {};
  const caseScope = depts ? { departmentId: inDepts } : {};
  const [recentUsers, openTickets, openFeedback, recentAudit, failedJobs, heartbeat] =
    await Promise.all([
      prisma.user.findMany({
        where: userScope,
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          createdAt: true,
          student: { select: { id: true } },
          facultyMember: { select: { id: true } },
        },
      }),
      prisma.supportTicket.count({
        where: { ...caseScope, status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_ON_USER'] } },
      }),
      prisma.feedback.count({
        where: { ...caseScope, status: { in: ['OPEN', 'UNDER_REVIEW', 'IN_PROGRESS'] } },
      }),
      hasPermission(actor.grants, 'audit:read')
        ? prisma.auditLog.findMany({
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: {
              id: true,
              action: true,
              entityType: true,
              createdAt: true,
              actor: { select: { firstName: true, lastName: true } },
            },
          })
        : Promise.resolve([]),
      hasGlobal(actor.grants, 'dashboard:admin') ? failedJobCount() : Promise.resolve(null),
      redis.get(HEARTBEAT_KEY).catch(() => null),
    ]);
  const belowMinimum = seatSections
    .filter((s) => s.course.minEnrollment !== null && s.enrolledCount < s.course.minEnrollment)
    .map((s) => ({
      sectionId: s.id,
      label: `${s.course.code} ${s.sectionCode}`,
      enrolled: s.enrolledCount,
      minimum: s.course.minEnrollment!,
    }));
  const withoutInstructor = seatSections
    .filter((s) => s.instructors.length === 0)
    .map((s) => ({ sectionId: s.id, label: `${s.course.code} ${s.sectionCode}` }));
  const workerStale =
    hasGlobal(actor.grants, 'dashboard:admin') &&
    (!heartbeat || Date.now() - new Date(heartbeat).getTime() > 3 * 60_000);

  return {
    scope: depts ? 'SCOPED' : 'UNIVERSITY',
    sessionIds: sessions,
    counts: {
      studentsTotal,
      studentsActive,
      faculty,
      admins,
      schools,
      departments,
      programs,
      specializations,
      courses,
      sections,
      registrations,
      activeSessions,
      pendingRegistrations,
      availableSeats: Math.max(0, capacity - enrolled),
      capacityUtilization: capacity ? round((enrolled / capacity) * 100) : null,
    },
    charts: {
      enrollmentTrend: [...trendSessions].reverse().map((s) => ({
        label: s.name,
        value: trendCounts.find((t) => t.sessionId === s.id)?._count._all ?? 0,
      })),
      studentsBySchool: sum(
        programCounts,
        (p) => p.department.school.code,
        (p) => p._count.students,
      ),
      studentsByDepartment: sum(
        programCounts,
        (p) => p.department.code,
        (p) => p._count.students,
      ).slice(0, 15),
      studentsByProgram: sum(
        programCounts,
        (p) => p.code,
        (p) => p._count.students,
      ).slice(0, 10),
      facultyByDepartment: facultyCounts
        .map((d) => ({ label: d.code, value: d._count.facultyMembers }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 15),
      topCourses: topCourseGroups.map((g) => {
        const c = topCourseRows.find((r) => r.id === g.courseId);
        return { label: c?.code ?? '?', title: c?.title ?? '', value: g._count._all };
      }),
      registrationStatus: statusGroups
        .map((g) => ({ label: g.status, value: g._count._all }))
        .sort((a, b) => b.value - a.value),
      utilizationByDepartment: [...utilization]
        .map(([label, u]) => ({
          label,
          value: u.capacity ? round((u.enrolled / u.capacity) * 100) : 0,
          enrolled: u.enrolled,
          capacity: u.capacity,
        }))
        .sort((a, b) => b.value - a.value),
    },
    widgets: {
      recentUsers: recentUsers.map((u) => ({
        id: u.id,
        name: `${u.firstName} ${u.lastName}`,
        email: u.email,
        kind: u.student ? 'STUDENT' : u.facultyMember ? 'FACULTY' : 'ADMIN',
        createdAt: u.createdAt.toISOString(),
      })),
      pending: {
        registrations: pendingRegistrations,
        tickets: openTickets,
        feedback: openFeedback,
      },
      recentAudit: recentAudit.map((a) => ({
        id: a.id,
        action: a.action,
        entityType: a.entityType,
        actor: a.actor ? `${a.actor.firstName} ${a.actor.lastName}` : 'System',
        createdAt: a.createdAt.toISOString(),
      })),
    },
    alerts: {
      failedJobs,
      workerStale,
      belowMinimum: belowMinimum.slice(0, 10),
      belowMinimumCount: belowMinimum.length,
      withoutInstructor: withoutInstructor.slice(0, 10),
      withoutInstructorCount: withoutInstructor.length,
    },
    generatedAt: new Date().toISOString(),
  };
}

async function failedJobCount() {
  try {
    const counts = await Promise.all(
      Object.values(QueueName).map((q) => getQueue(q).getJobCounts('failed')),
    );
    return counts.reduce((s, c) => s + (c.failed ?? 0), 0);
  } catch {
    return null;
  }
}

/** Dashboard for the caller's scope and filters, cached for 60 s (FR-ADMIN-001..006). */
export async function adminDashboard(actor: ActorContext, f: DashboardFilters) {
  const scope = JSON.stringify({
    g: actor.grants['dashboard:admin'] ?? [],
    a: hasPermission(actor.grants, 'audit:read'),
    f,
  });
  const version = await redis.get(VERSION_KEY).catch(() => null);
  const key = `dash:${version ?? 0}:${createHash('sha256').update(scope).digest('hex').slice(0, 32)}`;
  const cached = await redis.get(key).catch(() => null);
  if (cached)
    return { ...(JSON.parse(cached) as Awaited<ReturnType<typeof compute>>), cached: true };
  const data = await compute(actor, f);
  await redis.set(key, JSON.stringify(data), 'EX', CACHE_SECONDS).catch(() => undefined);
  return { ...data, cached: false };
}
