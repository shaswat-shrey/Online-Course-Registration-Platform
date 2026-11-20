import type { PermissionKey } from '@ucrams/shared';
import type { ActorContext } from '../../common/context/actor.js';
import { ForbiddenError, NotFoundError } from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { covers, hasGlobal, scopeFilter, type ScopeTarget } from '../authz/authz.js';

/**
 * Organisational locations of a user, for scope checks on user-level actions:
 * students via their program's department, faculty via their departments.
 * Administrators without either belong to no department (university-wide only).
 */
export async function userTargets(userId: string): Promise<ScopeTarget[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      student: {
        select: { program: { select: { department: { select: { id: true, schoolId: true } } } } },
      },
      facultyMember: {
        select: {
          department: { select: { id: true, schoolId: true } },
          secondaryDepartments: {
            select: { department: { select: { id: true, schoolId: true } } },
          },
        },
      },
    },
  });
  if (!user) throw new NotFoundError('User');
  const targets: ScopeTarget[] = [];
  const dept = user.student?.program.department;
  if (dept) targets.push({ departmentId: dept.id, schoolId: dept.schoolId });
  if (user.facultyMember) {
    const f = user.facultyMember;
    targets.push({ departmentId: f.department.id, schoolId: f.department.schoolId });
    for (const s of f.secondaryDepartments)
      targets.push({ departmentId: s.department.id, schoolId: s.department.schoolId });
  }
  return targets;
}

/** University-wide grant, or a grant covering one of the user's departments. */
export async function assertUserInScope(
  actor: ActorContext,
  permission: PermissionKey,
  userId: string,
) {
  if (hasGlobal(actor.grants, permission)) return;
  const targets = await userTargets(userId);
  if (!targets.some((t) => covers(actor.grants, permission, t))) throw new ForbiddenError();
}

/**
 * `where` fragment restricting rows owned by a department (via `path`) to the
 * actor's organisational scope. `null` = unrestricted. Throws when the actor
 * holds the permission only through relationship (OWN) grants.
 */
export function departmentWhere(actor: ActorContext, permission: PermissionKey) {
  const filter = scopeFilter(actor.grants, permission);
  if (!filter) return null;
  if (filter.departmentIds.length === 0 && filter.schoolIds.length === 0)
    throw new ForbiddenError();
  return { OR: [{ id: { in: filter.departmentIds } }, { schoolId: { in: filter.schoolIds } }] };
}
