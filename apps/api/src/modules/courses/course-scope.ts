import type { PermissionKey } from '@ucrams/shared';
import type { ActorContext } from '../../common/context/actor.js';
import { NotFoundError } from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { assertInScope, covers, hasPermission } from '../authz/authz.js';

/** Organisational location of a course (its department). */
export async function courseTarget(courseId: string) {
  const c = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      status: true,
      departmentId: true,
      department: { select: { schoolId: true } },
    },
  });
  if (!c) throw new NotFoundError('Course');
  return {
    courseId: c.id,
    status: c.status,
    departmentId: c.departmentId,
    schoolId: c.department.schoolId,
  };
}

export async function assertCourseScope(
  actor: ActorContext,
  permission: PermissionKey,
  courseId: string,
) {
  const target = await courseTarget(courseId);
  assertInScope(actor, permission, target);
  return target;
}

/**
 * Catalog managers (any organisational course grant) see drafts and inactive
 * courses; everyone else sees ACTIVE courses only.
 */
export function seesAllCourses(actor: ActorContext): boolean {
  return (['course:create', 'course:update', 'section:create', 'section:update'] as const).some(
    (p) => actor.grants[p]?.some((g) => g.scope !== 'OWN'),
  );
}

/** Section managers see every status; others see published sections and those they teach. */
export function seesAllSections(actor: ActorContext): boolean {
  return (['section:create', 'section:update', 'section:publish'] as const).some((p) =>
    actor.grants[p]?.some((g) => g.scope !== 'OWN'),
  );
}

export const canManageCourse = (
  actor: ActorContext,
  target: { departmentId: string; schoolId: string },
) => covers(actor.grants, 'course:update', target);

export { hasPermission };
