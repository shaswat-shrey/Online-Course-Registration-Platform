import type { SearchType } from '@ucrams/shared';
import type { ActorContext } from '../../common/context/actor.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { scopeFilter } from '../authz/authz.js';
import { searchCourseIds } from '../courses/courses.service.js';

export interface SearchHit {
  type: SearchType;
  id: string;
  title: string;
  subtitle: string | null;
}

const like = (q: string) => ({ contains: q, mode: 'insensitive' as const });

/**
 * Global search (FR-SRCH-001/002): catalog and structure for every signed-in
 * user, the faculty directory, and students only for holders of `student:read`
 * beyond their own sections, limited to their scope. Grouped by type.
 */
export async function search(
  actor: ActorContext,
  q: { q: string; types: SearchType[]; limit: number },
) {
  const want = new Set(q.types);
  const take = q.limit;
  const run = async <T>(type: SearchType, fn: () => Promise<T[]>) =>
    want.has(type) ? fn() : Promise.resolve([] as T[]);

  const studentScope = (actor.grants['student:read'] ?? []).some((g) => g.scope !== 'OWN')
    ? scopeFilter(actor.grants, 'student:read')
    : undefined;

  const [courses, departments, programs, specializations, faculty, students] = await Promise.all([
    run('course', async () => {
      const ids = (await searchCourseIds(q.q)).slice(0, take);
      const rows = await prisma.course.findMany({
        where: { id: { in: ids }, status: { not: 'ARCHIVED' } },
        select: { id: true, code: true, title: true, department: { select: { code: true } } },
      });
      return ids
        .map((id) => rows.find((r) => r.id === id))
        .filter((r): r is NonNullable<typeof r> => !!r)
        .map((r): SearchHit => ({
          type: 'course',
          id: r.id,
          title: `${r.code} · ${r.title}`,
          subtitle: r.department.code,
        }));
    }),
    run('department', async () =>
      (
        await prisma.department.findMany({
          where: { OR: [{ name: like(q.q) }, { code: like(q.q) }] },
          select: { id: true, code: true, name: true, school: { select: { name: true } } },
          orderBy: { name: 'asc' },
          take,
        })
      ).map((d): SearchHit => ({
        type: 'department',
        id: d.id,
        title: `${d.code} · ${d.name}`,
        subtitle: d.school.name,
      })),
    ),
    run('program', async () =>
      (
        await prisma.program.findMany({
          where: { OR: [{ name: like(q.q) }, { code: like(q.q) }] },
          select: { id: true, code: true, name: true, department: { select: { code: true } } },
          orderBy: { code: 'asc' },
          take,
        })
      ).map((p): SearchHit => ({
        type: 'program',
        id: p.id,
        title: `${p.code} · ${p.name}`,
        subtitle: p.department.code,
      })),
    ),
    run('specialization', async () =>
      (
        await prisma.specialization.findMany({
          where: { name: like(q.q) },
          select: { id: true, name: true, program: { select: { id: true, code: true } } },
          orderBy: { name: 'asc' },
          take,
        })
      ).map((s): SearchHit => ({
        type: 'specialization',
        id: s.program.id,
        title: s.name,
        subtitle: s.program.code,
      })),
    ),
    run('faculty', async () =>
      (
        await prisma.facultyMember.findMany({
          where: {
            employmentStatus: { not: 'INACTIVE' },
            OR: [
              { user: { firstName: like(q.q) } },
              { user: { lastName: like(q.q) } },
              { employeeNumber: like(q.q) },
            ],
          },
          select: {
            id: true,
            designation: true,
            user: { select: { firstName: true, lastName: true } },
            department: { select: { code: true } },
          },
          orderBy: { user: { lastName: 'asc' } },
          take,
        })
      ).map((f): SearchHit => ({
        type: 'faculty',
        id: f.id,
        title: `${f.user.firstName} ${f.user.lastName}`,
        subtitle: `${f.department.code} · ${f.designation.toLowerCase().replace(/_/g, ' ')}`,
      })),
    ),
    studentScope === undefined
      ? Promise.resolve([] as SearchHit[])
      : run('student', async () =>
          (
            await prisma.student.findMany({
              where: {
                ...(studentScope
                  ? {
                      program: {
                        OR: [
                          { departmentId: { in: studentScope.departmentIds } },
                          { department: { schoolId: { in: studentScope.schoolIds } } },
                        ],
                      },
                    }
                  : {}),
                OR: [
                  { studentNumber: like(q.q) },
                  { user: { firstName: like(q.q) } },
                  { user: { lastName: like(q.q) } },
                  { user: { email: like(q.q) } },
                ],
              },
              select: {
                id: true,
                studentNumber: true,
                user: { select: { firstName: true, lastName: true } },
                program: { select: { code: true } },
              },
              orderBy: { user: { lastName: 'asc' } },
              take,
            })
          ).map((s): SearchHit => ({
            type: 'student',
            id: s.id,
            title: `${s.user.firstName} ${s.user.lastName}`,
            subtitle: `${s.studentNumber} · ${s.program.code}`,
          })),
        ),
  ]);
  const groups = { courses, departments, programs, specializations, faculty, students };
  return {
    q: q.q,
    total: Object.values(groups).reduce((s, g) => s + g.length, 0),
    groups: [
      { type: 'course', items: courses },
      { type: 'department', items: departments },
      { type: 'program', items: programs },
      { type: 'specialization', items: specializations },
      { type: 'faculty', items: faculty },
      { type: 'student', items: students },
    ].filter((g) => want.has(g.type as SearchType) && g.items.length),
  };
}
