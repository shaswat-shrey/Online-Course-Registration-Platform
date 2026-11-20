import type { z } from 'zod';
import {
  ErrorCode,
  type corequisitesSchema,
  type courseProgramsSchema,
  type courseSpecializationsSchema,
  type prerequisitesSchema,
  type requirementCoursesSchema,
} from '@ucrams/shared';
import type { ActorContext } from '../../common/context/actor.js';
import { BusinessRuleError, NotFoundError } from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import { groupOwnerScope } from '../programs/programs.service.js';
import { assertCourseScope } from './course-scope.js';
import { courseDetailFor } from './courses.service.js';

const invalid = (path: string, message: string) =>
  new BusinessRuleError(ErrorCode.VALIDATION_ERROR, message, {
    fields: [{ path: `body.${path}`, message }],
  });

async function assertCoursesExist(ids: string[], path: string) {
  if (!ids.length) return [];
  const found = await prisma.course.findMany({
    where: { id: { in: ids } },
    select: { id: true, code: true, status: true },
  });
  if (found.length !== new Set(ids).size) throw invalid(path, 'One or more courses do not exist');
  return found;
}

/**
 * Finds a prerequisite path from any of `starts` back to `courseId` given the
 * proposed edges (BR-007). Returns the cycle as course ids, or null.
 */
export function findCycle(courseId: string, edges: Map<string, string[]>): string[] | null {
  const path: string[] = [];
  const done = new Set<string>();
  const visit = (node: string): boolean => {
    if (node === courseId && path.length > 0) return true;
    if (done.has(node)) return false;
    path.push(node);
    for (const next of edges.get(node) ?? []) if (visit(next)) return true;
    path.pop();
    done.add(node);
    return false;
  };
  return visit(courseId) ? [...path, courseId] : null;
}

export async function setPrerequisites(
  actor: ActorContext,
  courseId: string,
  input: z.output<typeof prerequisitesSchema>,
) {
  await assertCourseScope(actor, 'course:update', courseId);
  const required = input.groups.flatMap((g) => g.items.map((i) => i.courseId));
  if (required.includes(courseId))
    throw invalid('groups', 'A course cannot be its own prerequisite');
  const courses = await assertCoursesExist(required, 'groups');
  // Load the whole prerequisite graph (a few thousand edges at most) and add the proposal.
  const existing = await prisma.prerequisiteItem.findMany({
    where: { group: { courseId: { not: courseId } } },
    select: { requiredCourseId: true, group: { select: { courseId: true } } },
  });
  const edges = new Map<string, string[]>();
  for (const e of existing) {
    const list = edges.get(e.group.courseId) ?? [];
    list.push(e.requiredCourseId);
    edges.set(e.group.courseId, list);
  }
  edges.set(courseId, [...new Set(required)]);
  const cycle = findCycle(courseId, edges);
  if (cycle) {
    const codes = await prisma.course.findMany({
      where: { id: { in: cycle } },
      select: { id: true, code: true },
    });
    const byId = new Map(codes.map((c) => [c.id, c.code]));
    const chain = cycle.map((id) => byId.get(id) ?? id).join(' → ');
    throw new BusinessRuleError(
      ErrorCode.PREREQUISITE_CYCLE,
      `This would create a prerequisite cycle: ${chain}`,
      {
        cycle: cycle.map((id) => byId.get(id) ?? id),
      },
    );
  }
  const drafts = courses.filter((c) => c.status === 'DRAFT').map((c) => c.code);
  await prisma.$transaction(async (tx) => {
    await tx.prerequisiteGroup.deleteMany({ where: { courseId } });
    for (const [position, group] of input.groups.entries()) {
      await tx.prerequisiteGroup.create({
        data: {
          courseId,
          position,
          items: {
            create: group.items.map((i) => ({
              requiredCourseId: i.courseId,
              minGradeLetter: i.minGradeLetter,
            })),
          },
        },
      });
    }
    await recordAudit(
      actor,
      {
        action: 'course.prerequisites_set',
        entityType: 'Course',
        entityId: courseId,
        changes: input as never,
      },
      tx,
    );
  });
  const detail = await courseDetailFor(actor, courseId);
  return {
    ...detail,
    warnings: drafts.length ? [`Draft courses used as prerequisites: ${drafts.join(', ')}`] : [],
  };
}

export async function setCorequisites(
  actor: ActorContext,
  courseId: string,
  input: z.output<typeof corequisitesSchema>,
) {
  await assertCourseScope(actor, 'course:update', courseId);
  if (input.courseIds.includes(courseId))
    throw invalid('courseIds', 'A course cannot be its own corequisite');
  await assertCoursesExist(input.courseIds, 'courseIds');
  // A corequisite cannot also be a prerequisite of the same course.
  const overlap = await prisma.prerequisiteItem.count({
    where: { group: { courseId }, requiredCourseId: { in: input.courseIds } },
  });
  if (overlap > 0)
    throw invalid('courseIds', 'A course cannot be both a prerequisite and a corequisite');
  await prisma.$transaction(async (tx) => {
    await tx.courseCorequisite.deleteMany({ where: { courseId } });
    await tx.courseCorequisite.createMany({
      data: input.courseIds.map((corequisiteId) => ({ courseId, corequisiteId })),
    });
    await recordAudit(
      actor,
      {
        action: 'course.corequisites_set',
        entityType: 'Course',
        entityId: courseId,
        changes: input as never,
      },
      tx,
    );
  });
  return courseDetailFor(actor, courseId);
}

export async function setCoursePrograms(
  actor: ActorContext,
  courseId: string,
  input: z.output<typeof courseProgramsSchema>,
) {
  await assertCourseScope(actor, 'course:update', courseId);
  const ids = input.mappings.map((m) => m.programId);
  if ((await prisma.program.count({ where: { id: { in: ids } } })) !== ids.length)
    throw invalid('mappings', 'One or more programs do not exist');
  await prisma.$transaction(async (tx) => {
    await tx.courseProgram.deleteMany({ where: { courseId } });
    await tx.courseProgram.createMany({ data: input.mappings.map((m) => ({ courseId, ...m })) });
    await recordAudit(
      actor,
      {
        action: 'course.programs_set',
        entityType: 'Course',
        entityId: courseId,
        changes: input as never,
      },
      tx,
    );
  });
  return courseDetailFor(actor, courseId);
}

export async function setCourseSpecializations(
  actor: ActorContext,
  courseId: string,
  input: z.output<typeof courseSpecializationsSchema>,
) {
  await assertCourseScope(actor, 'course:update', courseId);
  const ids = input.mappings.map((m) => m.specializationId);
  if ((await prisma.specialization.count({ where: { id: { in: ids } } })) !== ids.length)
    throw invalid('mappings', 'One or more specializations do not exist');
  await prisma.$transaction(async (tx) => {
    await tx.courseSpecialization.deleteMany({ where: { courseId } });
    await tx.courseSpecialization.createMany({
      data: input.mappings.map((m) => ({ courseId, ...m })),
    });
    await recordAudit(
      actor,
      {
        action: 'course.specializations_set',
        entityType: 'Course',
        entityId: courseId,
        changes: input as never,
      },
      tx,
    );
  });
  return courseDetailFor(actor, courseId);
}

/** Checks that each restriction's target exists (shared by course and section restrictions). */
export async function assertRestrictionTargets(list: RestrictionLike[]) {
  const ids = (type: string) => list.filter((r) => r.targetType === type).map((r) => r.targetId!);
  const [d, p, s] = await Promise.all([
    prisma.department.count({ where: { id: { in: ids('DEPARTMENT') } } }),
    prisma.program.count({ where: { id: { in: ids('PROGRAM') } } }),
    prisma.specialization.count({ where: { id: { in: ids('SPECIALIZATION') } } }),
  ]);
  if (
    d !== new Set(ids('DEPARTMENT')).size ||
    p !== new Set(ids('PROGRAM')).size ||
    s !== new Set(ids('SPECIALIZATION')).size
  )
    throw invalid('restrictions', 'One or more restriction targets do not exist');
  const keys = list.map((r) => `${r.targetType}:${r.targetId ?? r.targetValue}`);
  if (new Set(keys).size !== keys.length)
    throw invalid('restrictions', 'The same target appears twice');
}
export type RestrictionLike = {
  mode: 'INCLUDE' | 'EXCLUDE';
  targetType: 'DEPARTMENT' | 'PROGRAM' | 'SPECIALIZATION' | 'YEAR_OF_STUDY';
  targetId: string | null;
  targetValue: number | null;
};

export async function setCourseRestrictions(
  actor: ActorContext,
  courseId: string,
  restrictions: RestrictionLike[],
) {
  await assertCourseScope(actor, 'course:update', courseId);
  await assertRestrictionTargets(restrictions);
  await prisma.$transaction(async (tx) => {
    await tx.courseRestriction.deleteMany({ where: { courseId } });
    await tx.courseRestriction.createMany({ data: restrictions.map((r) => ({ courseId, ...r })) });
    await recordAudit(
      actor,
      {
        action: 'course.restrictions_set',
        entityType: 'Course',
        entityId: courseId,
        changes: { restrictions } as never,
      },
      tx,
    );
  });
  return courseDetailFor(actor, courseId);
}

/** Course list of an ALL_OF / CREDITS_FROM_LIST requirement group (deferred from Phase 3). */
export async function setRequirementCourses(
  actor: ActorContext,
  groupId: string,
  input: z.output<typeof requirementCoursesSchema>,
) {
  const group = await prisma.requirementGroup.findUnique({ where: { id: groupId } });
  if (!group) throw new NotFoundError('Requirement group');
  await groupOwnerScope(actor, group);
  if (group.kind !== 'ALL_OF' && group.kind !== 'CREDITS_FROM_LIST')
    throw invalid(
      'courseIds',
      'Only "all of" and "credits from list" requirements have course lists',
    );
  const courses = await assertCoursesExist(input.courseIds, 'courseIds');
  const drafts = courses.filter((c) => c.status === 'DRAFT');
  if (drafts.length)
    throw invalid(
      'courseIds',
      `Draft courses cannot be required: ${drafts.map((c) => c.code).join(', ')}`,
    );
  await prisma.$transaction(async (tx) => {
    await tx.requirementCourse.deleteMany({ where: { requirementGroupId: groupId } });
    await tx.requirementCourse.createMany({
      data: input.courseIds.map((courseId) => ({ requirementGroupId: groupId, courseId })),
    });
    await recordAudit(
      actor,
      {
        action: 'requirement_group.courses_set',
        entityType: 'RequirementGroup',
        entityId: groupId,
        changes: input as never,
      },
      tx,
    );
  });
  const rows = await prisma.requirementCourse.findMany({
    where: { requirementGroupId: groupId },
    include: {
      course: { select: { id: true, code: true, title: true, credits: true, status: true } },
    },
    orderBy: { course: { code: 'asc' } },
  });
  return rows.map((r) => ({
    id: r.course.id,
    code: r.course.code,
    title: r.course.title,
    credits: r.course.credits.toNumber(),
    status: r.course.status,
  }));
}
