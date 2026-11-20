import { ErrorCode, type PermissionKey } from '@ucrams/shared';
import type { ActorContext } from '../common/context/actor.js';
import { BusinessRuleError, ConflictError, NotFoundError } from '../common/exceptions/app-error.js';
import { prisma } from '../infrastructure/database/prisma.js';
import { assertInScope, scopeFilter, type ScopeTarget } from './authz/authz.js';

/** Organisational location of a department (for scope checks). */
export async function departmentTarget(departmentId: string): Promise<Required<ScopeTarget>> {
  const dept = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { id: true, schoolId: true },
  });
  if (!dept) throw new NotFoundError('Department');
  return { departmentId: dept.id, schoolId: dept.schoolId };
}

export async function programTarget(programId: string) {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { id: true, departmentId: true, department: { select: { schoolId: true } } },
  });
  if (!program) throw new NotFoundError('Program');
  return {
    programId: program.id,
    departmentId: program.departmentId,
    schoolId: program.department.schoolId,
  };
}

export async function assertDepartmentScope(
  actor: ActorContext,
  permission: PermissionKey,
  departmentId: string,
) {
  const target = await departmentTarget(departmentId);
  assertInScope(actor, permission, target);
  return target;
}

/**
 * Prisma `where` restricting departments-owned rows to the actor's scope for a
 * permission, or `{}` when unrestricted. `path` reaches the department from the row.
 */
export function departmentScopeWhere(
  actor: ActorContext,
  permission: PermissionKey,
  path: 'self' | 'department',
) {
  const filter = scopeFilter(actor.grants, permission);
  if (!filter) return null;
  const clause = {
    OR: [{ id: { in: filter.departmentIds } }, { schoolId: { in: filter.schoolIds } }],
  };
  return path === 'self' ? clause : { department: clause };
}

/** Throws a field-level 409 when a unique code is already used. */
export function codeTaken(entity: string, field = 'code'): ConflictError {
  return new ConflictError(
    ErrorCode.UNIQUE_VIOLATION,
    `A ${entity} with this ${field} already exists`,
    {
      fields: [{ path: `body.${field}`, message: 'Already in use' }],
    },
  );
}

/** 422 for deleting/deactivating something that still has dependents. */
export function hasDependents(message: string, details: Record<string, number>): BusinessRuleError {
  return new BusinessRuleError(ErrorCode.INVALID_STATE_TRANSITION, message, details);
}
