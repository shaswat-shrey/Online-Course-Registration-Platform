import type { PermissionKey } from '@ucrams/shared';
import type { ActorContext } from '../../common/context/actor.js';
import { BusinessRuleError } from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { covers, scopeFilter } from '../authz/authz.js';
import { loadPerson } from '../messaging/people.js';

/** A case (feedback or ticket) is managed by administrators whose grant covers its department. */
export async function managesDepartment(
  actor: ActorContext,
  permission: PermissionKey,
  departmentId: string | null,
) {
  if (!departmentId) return covers(actor.grants, permission, {}) || isGlobal(actor, permission);
  const d = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { schoolId: true },
  });
  return covers(actor.grants, permission, { departmentId, schoolId: d?.schoolId });
}

const isGlobal = (actor: ActorContext, permission: PermissionKey) =>
  actor.grants[permission]?.some((g) => g.scope === 'GLOBAL') ?? false;

/** Prisma filter on `departmentId` for a manager's list (null = unrestricted). */
export function departmentScope(actor: ActorContext, permission: PermissionKey) {
  const scope = scopeFilter(actor.grants, permission);
  if (!scope) return {};
  return {
    OR: [
      { departmentId: { in: scope.departmentIds } },
      { department: { schoolId: { in: scope.schoolIds } } },
    ],
  };
}

/** True when the actor holds the permission organisationally (not just as a relationship). */
export const isManager = (actor: ActorContext, permission: PermissionKey) =>
  (actor.grants[permission] ?? []).some((g) => g.scope !== 'OWN');

/** Assignees must be active administrators who can manage cases in that department. */
export async function assertAssignable(
  userId: string,
  permission: PermissionKey,
  departmentId: string | null,
) {
  const person = await loadPerson(userId);
  const roles = await prisma.userRole.findMany({
    where: {
      userId,
      role: {
        scopeMode: 'ORGANIZATIONAL',
        permissions: { some: { permission: { key: permission } } },
      },
    },
    select: { scopeType: true, scopeId: true },
  });
  const dept = departmentId
    ? await prisma.department.findUnique({
        where: { id: departmentId },
        select: { schoolId: true },
      })
    : null;
  const ok =
    !!person?.active &&
    roles.some(
      (r) =>
        r.scopeType === 'GLOBAL' ||
        (r.scopeType === 'DEPARTMENT' && r.scopeId === departmentId) ||
        (r.scopeType === 'SCHOOL' && !!dept && r.scopeId === dept.schoolId),
    );
  if (!ok)
    throw new BusinessRuleError(
      'VALIDATION_ERROR',
      'Choose an administrator who handles these cases',
      {
        fields: [{ path: 'body.assigneeId', message: 'Not an eligible assignee' }],
      },
    );
}

/** Administrators eligible to be assigned cases in a department (for assignee pickers). */
export async function assignees(permission: PermissionKey, departmentId: string | null) {
  const dept = departmentId
    ? await prisma.department.findUnique({
        where: { id: departmentId },
        select: { schoolId: true },
      })
    : null;
  const users = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      roles: {
        some: {
          role: {
            scopeMode: 'ORGANIZATIONAL',
            permissions: { some: { permission: { key: permission } } },
          },
          OR: [
            { scopeType: 'GLOBAL' },
            ...(departmentId ? [{ scopeType: 'DEPARTMENT' as const, scopeId: departmentId }] : []),
            ...(dept ? [{ scopeType: 'SCHOOL' as const, scopeId: dept.schoolId }] : []),
          ],
        },
      },
    },
    select: { id: true, firstName: true, lastName: true, email: true },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    take: 100,
  });
  return users.map((u) => ({ userId: u.id, name: `${u.firstName} ${u.lastName}`, email: u.email }));
}
