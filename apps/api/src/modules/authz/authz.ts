import type { PermissionKey } from '@ucrams/shared';
import type { ActorContext, Grant, GrantMap } from '../../common/context/actor.js';
import { ForbiddenError } from '../../common/exceptions/app-error.js';

/** Organisational location of a resource, used for scope checks. */
export interface ScopeTarget {
  schoolId?: string | null;
  departmentId?: string | null;
}

/** Held at any scope, including OWN. Coarse route check only. */
export function hasPermission(grants: GrantMap, permission: PermissionKey): boolean {
  return (grants[permission]?.length ?? 0) > 0;
}

/**
 * Held through a relationship role or an organisational grant. Module policies
 * combine this with a relationship check (teaches this section, owns this record).
 */
export function hasOwnGrant(grants: GrantMap, permission: PermissionKey): boolean {
  return grants[permission]?.some((g) => g.scope === 'OWN') ?? false;
}

export function hasGlobal(grants: GrantMap, permission: PermissionKey): boolean {
  return grants[permission]?.some((g) => g.scope === 'GLOBAL') ?? false;
}

/** True if a single grant covers the target (GLOBAL ⊇ SCHOOL ⊇ DEPARTMENT; OWN covers nothing). */
export function grantCovers(grant: Grant, target: ScopeTarget): boolean {
  switch (grant.scope) {
    case 'OWN':
      return false;
    case 'GLOBAL':
      return true;
    case 'SCHOOL':
      return !!target.schoolId && grant.id === target.schoolId;
    case 'DEPARTMENT':
      return !!target.departmentId && grant.id === target.departmentId;
  }
}

export function covers(grants: GrantMap, permission: PermissionKey, target: ScopeTarget): boolean {
  return grants[permission]?.some((g) => grantCovers(g, target)) ?? false;
}

export function assertPermission(actor: ActorContext, permission: PermissionKey): void {
  if (!hasPermission(actor.grants, permission)) throw new ForbiddenError();
}

/** Requires a university-wide grant (for resources that have no school/department). */
export function assertGlobal(actor: ActorContext, permission: PermissionKey): void {
  if (!hasGlobal(actor.grants, permission)) throw new ForbiddenError();
}

export function assertInScope(
  actor: ActorContext,
  permission: PermissionKey,
  target: ScopeTarget,
): void {
  if (!covers(actor.grants, permission, target)) throw new ForbiddenError();
}

/**
 * Scope filter for list queries: `null` means unrestricted; otherwise the
 * caller restricts to the returned school/department ids (empty = nothing).
 */
export function scopeFilter(
  grants: GrantMap,
  permission: PermissionKey,
): { schoolIds: string[]; departmentIds: string[] } | null {
  const list = grants[permission] ?? [];
  if (list.some((g) => g.scope === 'GLOBAL')) return null;
  return {
    schoolIds: list.flatMap((g) => (g.scope === 'SCHOOL' ? [g.id] : [])),
    departmentIds: list.flatMap((g) => (g.scope === 'DEPARTMENT' ? [g.id] : [])),
  };
}
