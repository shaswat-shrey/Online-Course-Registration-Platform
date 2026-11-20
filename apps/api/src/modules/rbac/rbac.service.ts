import { ErrorCode, isPermissionKey, RoleKey, type PermissionKey } from '@ucrams/shared';
import type { ActorContext } from '../../common/context/actor.js';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import { assertGlobal, assertInScope, covers, type ScopeTarget } from '../authz/authz.js';
import { bumpPermissionsVersion } from '../authz/grants.service.js';
import { resolveScope, type ScopeInput } from './scope-resolver.js';

const roleSelect = {
  id: true,
  key: true,
  name: true,
  description: true,
  isSystem: true,
  scopeMode: true,
  createdAt: true,
  updatedAt: true,
  permissions: { select: { permission: { select: { key: true } } } },
  _count: { select: { users: true } },
} as const;

type RoleRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  scopeMode: 'ORGANIZATIONAL' | 'RELATIONSHIP';
  createdAt: Date;
  updatedAt: Date;
  permissions: { permission: { key: string } }[];
  _count: { users: number };
};

function toRoleDto(r: RoleRow) {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    scopeMode: r.scopeMode,
    permissions: r.permissions.map((p) => p.permission.key).sort(),
    assignmentCount: r._count.users,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
export type RoleDto = ReturnType<typeof toRoleDto>;

export async function listPermissions(actor: ActorContext) {
  assertGlobal(actor, 'rbac:read');
  const rows = await prisma.permission.findMany({
    orderBy: [{ resource: 'asc' }, { action: 'asc' }],
  });
  return rows.map((p) => ({
    key: p.key,
    resource: p.resource,
    action: p.action,
    description: p.description,
  }));
}

export async function listRoles(actor: ActorContext): Promise<RoleDto[]> {
  assertGlobal(actor, 'rbac:read');
  const rows = await prisma.role.findMany({
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    select: roleSelect,
  });
  return rows.map(toRoleDto);
}

export async function getRole(actor: ActorContext, id: string): Promise<RoleDto> {
  assertGlobal(actor, 'rbac:read');
  const row = await prisma.role.findUnique({ where: { id }, select: roleSelect });
  if (!row) throw new NotFoundError('Role');
  return toRoleDto(row);
}

function validateKeys(keys: string[]): PermissionKey[] {
  const unknown = keys.filter((k) => !isPermissionKey(k));
  if (unknown.length > 0) {
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Unknown permissions', { unknown });
  }
  return [...new Set(keys)] as PermissionKey[];
}

/** Nobody can grant a permission they do not hold university-wide (escalation guard). */
function assertCanGrant(actor: ActorContext, keys: PermissionKey[], target: ScopeTarget = {}) {
  const missing = keys.filter((k) => !covers(actor.grants, k, target));
  if (missing.length > 0) {
    throw new ForbiddenError('You cannot grant permissions you do not hold yourself');
  }
}

async function permissionIds(keys: PermissionKey[]) {
  const rows = await prisma.permission.findMany({
    where: { key: { in: keys } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function usersWithRole(roleId: string): Promise<string[]> {
  const rows = await prisma.userRole.findMany({
    where: { roleId },
    select: { userId: true },
    distinct: ['userId'],
  });
  return rows.map((r) => r.userId);
}

export async function createRole(
  actor: ActorContext,
  input: { key: string; name: string; description?: string | null; permissions: string[] },
): Promise<RoleDto> {
  assertGlobal(actor, 'rbac:manage');
  const keys = validateKeys(input.permissions);
  assertCanGrant(actor, keys);
  if (await prisma.role.findUnique({ where: { key: input.key } })) {
    throw new ConflictError(ErrorCode.UNIQUE_VIOLATION, 'A role with this key already exists', {
      fields: [{ path: 'body.key', message: 'Already in use' }],
    });
  }
  const ids = await permissionIds(keys);
  const role = await prisma.$transaction(async (tx) => {
    const created = await tx.role.create({
      data: {
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        permissions: { create: ids.map((permissionId) => ({ permissionId })) },
      },
      select: roleSelect,
    });
    await recordAudit(
      actor,
      {
        action: 'rbac.role_created',
        entityType: 'Role',
        entityId: created.id,
        changes: { key: input.key, name: input.name, permissions: keys },
      },
      tx,
    );
    return created;
  });
  return toRoleDto(role);
}

export async function updateRole(
  actor: ActorContext,
  id: string,
  input: { name?: string; description?: string | null },
): Promise<RoleDto> {
  assertGlobal(actor, 'rbac:manage');
  const before = await prisma.role.findUnique({ where: { id } });
  if (!before) throw new NotFoundError('Role');
  const role = await prisma.$transaction(async (tx) => {
    const updated = await tx.role.update({ where: { id }, data: input, select: roleSelect });
    await recordAudit(
      actor,
      {
        action: 'rbac.role_updated',
        entityType: 'Role',
        entityId: id,
        changes: {
          name: { from: before.name, to: updated.name },
          description: { from: before.description, to: updated.description },
        },
      },
      tx,
    );
    return updated;
  });
  return toRoleDto(role);
}

export async function setRolePermissions(
  actor: ActorContext,
  id: string,
  permissions: string[],
): Promise<RoleDto> {
  assertGlobal(actor, 'rbac:manage');
  const role = await prisma.role.findUnique({ where: { id }, select: roleSelect });
  if (!role) throw new NotFoundError('Role');
  if (role.key === RoleKey.SUPER_ADMIN) {
    // Editing the super admin role could lock everyone out of RBAC administration.
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      'The Super Administrator role cannot be modified',
    );
  }
  const next = validateKeys(permissions);
  const current = new Set(role.permissions.map((p) => p.permission.key));
  const added = next.filter((k) => !current.has(k));
  const removed = [...current].filter((k) => !next.includes(k as PermissionKey));
  assertCanGrant(actor, added);
  if (added.length === 0 && removed.length === 0) return toRoleDto(role);

  const ids = await permissionIds(next);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId: id } });
    await tx.rolePermission.createMany({
      data: ids.map((permissionId) => ({ roleId: id, permissionId })),
    });
    await recordAudit(
      actor,
      {
        action: 'rbac.role_permissions_changed',
        entityType: 'Role',
        entityId: id,
        changes: { added, removed },
      },
      tx,
    );
    return tx.role.findUniqueOrThrow({ where: { id }, select: roleSelect });
  });
  await bumpPermissionsVersion(await usersWithRole(id));
  return toRoleDto(updated);
}

export async function deleteRole(actor: ActorContext, id: string): Promise<void> {
  assertGlobal(actor, 'rbac:manage');
  const role = await prisma.role.findUnique({ where: { id }, select: roleSelect });
  if (!role) throw new NotFoundError('Role');
  if (role.isSystem)
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      'System roles cannot be deleted',
    );
  if (role._count.users > 0) {
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      'Remove all assignments of this role before deleting it',
      {
        assignmentCount: role._count.users,
      },
    );
  }
  await prisma.$transaction(async (tx) => {
    await tx.role.delete({ where: { id } });
    await recordAudit(
      actor,
      { action: 'rbac.role_deleted', entityType: 'Role', entityId: id, changes: { key: role.key } },
      tx,
    );
  });
}

// ----- User role assignments ------------------------------------------------

export async function listUserRoles(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new NotFoundError('User');
  const rows = await prisma.userRole.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      scopeType: true,
      scopeId: true,
      createdAt: true,
      role: { select: { id: true, key: true, name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    roleId: r.role.id,
    roleKey: r.role.key,
    roleName: r.role.name,
    scopeType: r.scopeType,
    scopeId: r.scopeId,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function roleForAssignment(roleId: string) {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: {
      key: true,
      scopeMode: true,
      permissions: { select: { permission: { select: { key: true } } } },
    },
  });
  if (!role) throw new NotFoundError('Role');
  return {
    key: role.key,
    scopeMode: role.scopeMode,
    permissions: role.permissions.map((p) => p.permission.key).filter(isPermissionKey),
  };
}

/**
 * Escalation guard (USER_ROLES_AND_PERMISSIONS.md §4). Organisational roles may
 * only be granted by someone who holds every one of their permissions at the
 * target scope. Relationship roles (faculty, student) confer no organisational
 * power (their grants are OWN-scoped), so assigning them needs only
 * user:assign_roles at the target scope.
 */
function assertCanAssign(
  actor: ActorContext,
  role: Awaited<ReturnType<typeof roleForAssignment>>,
  target: ScopeTarget,
) {
  assertInScope(actor, 'user:assign_roles', target);
  if (role.scopeMode === 'ORGANIZATIONAL') assertCanGrant(actor, role.permissions, target);
}

export async function assignRole(
  actor: ActorContext,
  userId: string,
  input: { roleId: string } & ScopeInput,
) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new NotFoundError('User');
  const role = await roleForAssignment(input.roleId);
  if (role.scopeMode === 'RELATIONSHIP' && input.scopeType !== 'GLOBAL') {
    throw new BusinessRuleError(
      ErrorCode.VALIDATION_ERROR,
      'This role applies to the holder’s own sections and records; assign it without a school or department scope',
    );
  }
  const target = await resolveScope(input);
  assertCanAssign(actor, role, target);

  const scopeId = input.scopeType === 'GLOBAL' ? null : input.scopeId;
  const existing = await prisma.userRole.findFirst({
    where: { userId, roleId: input.roleId, scopeType: input.scopeType, scopeId },
  });
  if (existing)
    throw new ConflictError(
      ErrorCode.UNIQUE_VIOLATION,
      'The user already has this role at this scope',
    );

  const assignment = await prisma.$transaction(async (tx) => {
    const created = await tx.userRole.create({
      data: {
        userId,
        roleId: input.roleId,
        scopeType: input.scopeType,
        scopeId,
        assignedById: actor.userId,
      },
    });
    await recordAudit(
      actor,
      {
        action: 'rbac.role_assigned',
        entityType: 'User',
        entityId: userId,
        changes: { role: role.key, scopeType: input.scopeType, scopeId },
      },
      tx,
    );
    return created;
  });
  await bumpPermissionsVersion([userId]);
  return { id: assignment.id };
}

export async function revokeRole(
  actor: ActorContext,
  userId: string,
  assignmentId: string,
): Promise<void> {
  const assignment = await prisma.userRole.findFirst({
    where: { id: assignmentId, userId },
    include: { role: { select: { key: true } } },
  });
  if (!assignment) throw new NotFoundError('Role assignment');
  const role = await roleForAssignment(assignment.roleId);
  const target: ScopeTarget =
    assignment.scopeType === 'SCHOOL'
      ? { schoolId: assignment.scopeId }
      : assignment.scopeType === 'DEPARTMENT'
        ? { departmentId: assignment.scopeId }
        : {};
  assertCanAssign(actor, role, target);

  if (assignment.role.key === RoleKey.SUPER_ADMIN) {
    const remaining = await prisma.userRole.count({
      where: { role: { key: RoleKey.SUPER_ADMIN }, id: { not: assignmentId } },
    });
    if (remaining === 0) {
      throw new BusinessRuleError(
        ErrorCode.INVALID_STATE_TRANSITION,
        'At least one Super Administrator must remain',
      );
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.userRole.delete({ where: { id: assignmentId } });
    await recordAudit(
      actor,
      {
        action: 'rbac.role_revoked',
        entityType: 'User',
        entityId: userId,
        changes: {
          role: assignment.role.key,
          scopeType: assignment.scopeType,
          scopeId: assignment.scopeId,
        },
      },
      tx,
    );
  });
  await bumpPermissionsVersion([userId]);
}
