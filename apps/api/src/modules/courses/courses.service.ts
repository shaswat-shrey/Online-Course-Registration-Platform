import type { z } from 'zod';
import {
  ErrorCode,
  type courseCreateSchema,
  type courseUpdateSchema,
  type CourseStatus,
} from '@ucrams/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext } from '../../common/context/actor.js';
import { BusinessRuleError, NotFoundError } from '../../common/exceptions/app-error.js';
import { num, paging, toOrderBy } from '../../common/http/list-query.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { diffChanges, recordAudit } from '../audit/audit.service.js';
import { assertInScope, covers } from '../authz/authz.js';
import { codeTaken, departmentTarget, hasDependents } from '../structure-scope.js';
import { canManageCourse, seesAllCourses } from './course-scope.js';

const invalid = (path: string, message: string) =>
  new BusinessRuleError(ErrorCode.VALIDATION_ERROR, message, {
    fields: [{ path: `body.${path}`, message }],
  });

const courseRef = {
  select: { id: true, code: true, title: true, credits: true, status: true },
} as const;
export const refDto = (c: {
  id: string;
  code: string;
  title: string;
  credits: Prisma.Decimal;
  status: string;
}) => ({ id: c.id, code: c.code, title: c.title, credits: num(c.credits)!, status: c.status });

const listInclude = {
  department: { select: { id: true, code: true, name: true, schoolId: true } },
  coordinator: {
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  },
  _count: { select: { sections: true, prerequisiteGroups: true } },
} as const;

const detailInclude = {
  ...listInclude,
  outcomes: { orderBy: { position: 'asc' as const } },
  assessmentComponents: { orderBy: { position: 'asc' as const } },
  prerequisiteGroups: {
    orderBy: { position: 'asc' as const },
    include: { items: { include: { requiredCourse: courseRef } } },
  },
  corequisites: { include: { corequisite: courseRef } },
  requiredBy: { select: { group: { select: { course: courseRef } } } },
  programs: {
    include: { program: { select: { id: true, code: true, name: true } } },
  },
  specializations: {
    include: {
      specialization: {
        select: { id: true, code: true, name: true, program: { select: { id: true, code: true } } },
      },
    },
  },
  restrictions: true,
  requirementGroups: {
    select: {
      requirementGroup: {
        select: {
          id: true,
          name: true,
          kind: true,
          program: { select: { id: true, code: true } },
          specialization: { select: { id: true, code: true } },
        },
      },
    },
  },
} as const;

type ListRow = Prisma.CourseGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.CourseGetPayload<{ include: typeof detailInclude }>;

function listDto(c: ListRow, actor: ActorContext) {
  return {
    id: c.id,
    code: c.code,
    title: c.title,
    description: c.description,
    department: { id: c.department.id, code: c.department.code, name: c.department.name },
    credits: num(c.credits)!,
    level: c.level,
    category: c.category,
    recommendedYear: c.recommendedYear,
    recommendedSessionType: c.recommendedSessionType,
    defaultCapacity: c.defaultCapacity,
    minEnrollment: c.minEnrollment,
    coordinator: c.coordinator
      ? {
          id: c.coordinator.id,
          name: `${c.coordinator.user.firstName} ${c.coordinator.user.lastName}`,
        }
      : null,
    isRepeatable: c.isRepeatable,
    status: c.status,
    sectionCount: c._count.sections,
    hasPrerequisites: c._count.prerequisiteGroups > 0,
    canManage: canManageCourse(actor, {
      departmentId: c.departmentId,
      schoolId: c.department.schoolId,
    }),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** Resolves restriction targets to display names. */
export async function restrictionDtos(
  rows: Array<{
    id: string;
    mode: string;
    targetType: string;
    targetId: string | null;
    targetValue: number | null;
  }>,
) {
  const ids = (type: string) => rows.filter((r) => r.targetType === type).map((r) => r.targetId!);
  const [depts, programs, specs] = await Promise.all([
    prisma.department.findMany({
      where: { id: { in: ids('DEPARTMENT') } },
      select: { id: true, code: true, name: true },
    }),
    prisma.program.findMany({
      where: { id: { in: ids('PROGRAM') } },
      select: { id: true, code: true, name: true },
    }),
    prisma.specialization.findMany({
      where: { id: { in: ids('SPECIALIZATION') } },
      select: { id: true, code: true, name: true },
    }),
  ]);
  const names = new Map(
    [...depts, ...programs, ...specs].map((x) => [x.id, `${x.name} (${x.code})`]),
  );
  return rows.map((r) => ({
    id: r.id,
    mode: r.mode,
    targetType: r.targetType,
    targetId: r.targetId,
    targetValue: r.targetValue,
    label:
      r.targetType === 'YEAR_OF_STUDY'
        ? `Year ${r.targetValue}`
        : (names.get(r.targetId!) ?? 'Unknown'),
  }));
}

async function detailDto(c: DetailRow, actor: ActorContext) {
  const visible = seesAllCourses(actor);
  const sections = await prisma.courseSection.groupBy({
    by: ['status'],
    where: { courseId: c.id },
    _count: true,
  });
  return {
    ...listDto(c, actor),
    syllabus: c.syllabus,
    outcomes: c.outcomes.map((o) => o.description),
    assessmentComponents: c.assessmentComponents.map((a) => ({
      name: a.name,
      weight: num(a.weight)!,
    })),
    prerequisites: c.prerequisiteGroups.map((g) => ({
      id: g.id,
      items: g.items.map((i) => ({
        course: refDto(i.requiredCourse),
        minGradeLetter: i.minGradeLetter,
      })),
    })),
    corequisites: c.corequisites.map((r) => refDto(r.corequisite)),
    requiredBy: c.requiredBy
      .map((r) => r.group.course)
      .filter((x) => visible || x.status === 'ACTIVE')
      .map(refDto),
    programs: c.programs.map((m) => ({ ...m.program, mappingType: m.mappingType })),
    specializations: c.specializations.map((m) => ({
      id: m.specialization.id,
      code: m.specialization.code,
      name: m.specialization.name,
      program: m.specialization.program,
      mappingType: m.mappingType,
    })),
    restrictions: await restrictionDtos(c.restrictions),
    requirementGroups: c.requirementGroups.map((r) => ({
      id: r.requirementGroup.id,
      name: r.requirementGroup.name,
      kind: r.requirementGroup.kind,
      owner: r.requirementGroup.program?.code ?? r.requirementGroup.specialization?.code ?? '',
    })),
    sectionsByStatus: Object.fromEntries(sections.map((s) => [s.status, s._count])),
    canArchive: covers(actor.grants, 'course:archive', {
      departmentId: c.departmentId,
      schoolId: c.department.schoolId,
    }),
  };
}

/**
 * Ranked full-text + trigram search over code/title/description (DATABASE.md §5).
 * Returns ids in relevance order (capped).
 */
export async function searchCourseIds(q: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM courses
    WHERE search_vector @@ websearch_to_tsquery('english', ${q})
       OR code ILIKE ${`${q.replace(/[%_\\]/g, '\\$&')}%`}
       OR title % ${q}
    ORDER BY (code ILIKE ${`${q.replace(/[%_\\]/g, '\\$&')}%`}) DESC,
             ts_rank(search_vector, websearch_to_tsquery('english', ${q})) DESC,
             similarity(title, ${q}) DESC
    LIMIT 1000`;
  return rows.map((r) => r.id);
}

export interface CourseListQuery {
  page: number;
  limit: number;
  q?: string;
  status?: string;
  departmentId?: string;
  schoolId?: string;
  category?: string;
  level?: number;
  programId?: string;
  specializationId?: string;
  minCredits?: number;
  maxCredits?: number;
  sort: {
    field: 'code' | 'title' | 'level' | 'credits' | 'createdAt';
    direction: 'asc' | 'desc';
  }[];
}

export async function listCourses(actor: ActorContext, q: CourseListQuery) {
  const all = seesAllCourses(actor);
  const ids = q.q ? await searchCourseIds(q.q) : null;
  const where: Prisma.CourseWhereInput = {
    ...(ids ? { id: { in: ids } } : {}),
    ...(all ? (q.status ? { status: q.status as CourseStatus } : {}) : { status: 'ACTIVE' }),
    ...(q.departmentId ? { departmentId: q.departmentId } : {}),
    ...(q.schoolId ? { department: { schoolId: q.schoolId } } : {}),
    ...(q.category ? { category: q.category as never } : {}),
    ...(q.level ? { level: q.level } : {}),
    ...(q.programId ? { programs: { some: { programId: q.programId } } } : {}),
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
      include: listInclude,
      orderBy: [...toOrderBy(q.sort), { id: 'asc' }],
      ...paging(q),
    }),
  ]);
  return { total, items: rows.map((r) => listDto(r, actor)) };
}

export async function findDetail(id: string) {
  return prisma.course.findUnique({ where: { id }, include: detailInclude });
}

export async function getCourse(actor: ActorContext, id: string) {
  const row = await findDetail(id);
  // Unpublished catalog entries are invisible to non-managers.
  if (!row || (row.status !== 'ACTIVE' && !seesAllCourses(actor)))
    throw new NotFoundError('Course');
  return detailDto(row, actor);
}

export async function courseDetailFor(actor: ActorContext, id: string) {
  const row = await findDetail(id);
  if (!row) throw new NotFoundError('Course');
  return detailDto(row, actor);
}

async function assertActiveDepartment(departmentId: string) {
  const dept = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!dept) throw invalid('departmentId', 'Unknown department');
  if (dept.status !== 'ACTIVE') throw invalid('departmentId', 'Choose an active department');
}

/** A coordinator must be an active faculty member of the course's department (primary or joint). */
async function assertCoordinator(departmentId: string, coordinatorId: string | null | undefined) {
  if (!coordinatorId) return;
  const f = await prisma.facultyMember.findUnique({
    where: { id: coordinatorId },
    select: {
      departmentId: true,
      employmentStatus: true,
      secondaryDepartments: { select: { departmentId: true } },
    },
  });
  if (!f) throw invalid('coordinatorId', 'Unknown faculty member');
  if (f.employmentStatus === 'INACTIVE')
    throw invalid('coordinatorId', 'Choose an active faculty member');
  if (
    f.departmentId !== departmentId &&
    !f.secondaryDepartments.some((d) => d.departmentId === departmentId)
  )
    throw invalid('coordinatorId', 'The coordinator must belong to the course’s department');
}

const ALLOWED: Record<CourseStatus, CourseStatus[]> = {
  DRAFT: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['INACTIVE', 'ARCHIVED'],
  INACTIVE: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: ['INACTIVE'],
};

async function assertStatusChange(
  actor: ActorContext,
  courseId: string,
  from: CourseStatus,
  to: CourseStatus,
  target: { departmentId: string; schoolId: string },
) {
  if (from === to) return;
  if (!ALLOWED[from].includes(to)) {
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      `A ${from.toLowerCase()} course cannot become ${to.toLowerCase()}`,
      { from, to },
    );
  }
  if (to === 'ARCHIVED' || from === 'ARCHIVED') assertInScope(actor, 'course:archive', target);
  if (to !== 'ACTIVE') {
    const open = await prisma.courseSection.count({
      where: { courseId, status: { in: ['PUBLISHED', 'CLOSED'] } },
    });
    if (open > 0)
      throw hasDependents('Close or complete this course’s published sections first', {
        openSections: open,
      });
  }
}

type CreateInput = z.output<typeof courseCreateSchema>;
type UpdateInput = z.output<typeof courseUpdateSchema>;

function childWrites(
  input: { outcomes?: string[]; assessmentComponents?: { name: string; weight: number }[] },
  replace: boolean,
) {
  const reset = replace ? { deleteMany: {} } : {};
  return {
    ...(input.outcomes
      ? {
          outcomes: {
            ...reset,
            create: input.outcomes.map((description, position) => ({ description, position })),
          },
        }
      : {}),
    ...(input.assessmentComponents
      ? {
          assessmentComponents: {
            ...reset,
            create: input.assessmentComponents.map((a, position) => ({ ...a, position })),
          },
        }
      : {}),
  };
}

export async function createCourse(actor: ActorContext, input: CreateInput) {
  const target = await departmentTarget(input.departmentId);
  assertInScope(actor, 'course:create', target);
  await assertActiveDepartment(input.departmentId);
  if (await prisma.course.findUnique({ where: { code: input.code } })) throw codeTaken('course');
  await assertCoordinator(input.departmentId, input.coordinatorId);
  if (input.status !== 'DRAFT' && input.status !== 'ACTIVE')
    throw invalid('status', 'New courses start as draft or active');
  const { outcomes, assessmentComponents, ...fields } = input;
  const id = await prisma.$transaction(async (tx) => {
    const c = await tx.course.create({
      data: { ...fields, ...childWrites({ outcomes, assessmentComponents }, false) },
    });
    await recordAudit(
      actor,
      { action: 'course.created', entityType: 'Course', entityId: c.id, changes: input as never },
      tx,
    );
    return c.id;
  });
  return courseDetailFor(actor, id);
}

export async function updateCourse(actor: ActorContext, id: string, input: UpdateInput) {
  const before = await prisma.course.findUnique({ where: { id }, include: { department: true } });
  if (!before) throw new NotFoundError('Course');
  const target = { departmentId: before.departmentId, schoolId: before.department.schoolId };
  assertInScope(actor, 'course:update', target);
  const departmentId = input.departmentId ?? before.departmentId;
  if (input.departmentId && input.departmentId !== before.departmentId) {
    // Moving a course needs authority over the destination department too.
    assertInScope(actor, 'course:update', await departmentTarget(input.departmentId));
    await assertActiveDepartment(input.departmentId);
  }
  if (
    input.code &&
    input.code !== before.code &&
    (await prisma.course.findUnique({ where: { code: input.code } }))
  )
    throw codeTaken('course');
  if (input.coordinatorId !== undefined || input.departmentId)
    await assertCoordinator(
      departmentId,
      input.coordinatorId === undefined ? before.coordinatorId : input.coordinatorId,
    );
  if (input.status) await assertStatusChange(actor, id, before.status, input.status, target);
  const capacity =
    input.defaultCapacity === undefined ? before.defaultCapacity : input.defaultCapacity;
  const minimum = input.minEnrollment === undefined ? before.minEnrollment : input.minEnrollment;
  if (capacity != null && minimum != null && minimum > capacity)
    throw invalid('minEnrollment', 'Minimum enrollment cannot exceed the default capacity');
  const { outcomes, assessmentComponents, ...fields } = input;
  await prisma.$transaction(async (tx) => {
    const after = await tx.course.update({
      where: { id },
      data: { ...fields, ...childWrites({ outcomes, assessmentComponents }, true) },
    });
    const { department: _d, ...plain } = before;
    void _d;
    await recordAudit(
      actor,
      {
        action:
          input.status && input.status !== before.status
            ? 'course.status_changed'
            : 'course.updated',
        entityType: 'Course',
        entityId: id,
        changes: {
          ...(diffChanges(plain, after) as object),
          ...(outcomes ? { outcomes: { to: outcomes } } : {}),
          ...(assessmentComponents ? { assessmentComponents: { to: assessmentComponents } } : {}),
        } as never,
      },
      tx,
    );
  });
  return courseDetailFor(actor, id);
}

export async function deleteCourse(actor: ActorContext, id: string) {
  const row = await prisma.course.findUnique({
    where: { id },
    include: {
      department: true,
      _count: {
        select: { sections: true, requiredBy: true, corequisiteOf: true, requirementGroups: true },
      },
    },
  });
  if (!row) throw new NotFoundError('Course');
  assertInScope(actor, 'course:create', {
    departmentId: row.departmentId,
    schoolId: row.department.schoolId,
  });
  if (row.status !== 'DRAFT')
    throw hasDependents('Only draft courses can be deleted; archive it instead', {});
  const { sections, requiredBy, corequisiteOf, requirementGroups } = row._count;
  if (sections + requiredBy + corequisiteOf + requirementGroups > 0)
    throw hasDependents('This course is referenced elsewhere; remove those references first', {
      sections,
      prerequisiteOf: requiredBy,
      corequisiteOf,
      requirementGroups,
    });
  await prisma.$transaction(async (tx) => {
    await tx.course.delete({ where: { id } });
    await recordAudit(
      actor,
      { action: 'course.deleted', entityType: 'Course', entityId: id, changes: { code: row.code } },
      tx,
    );
  });
}
