import { PERMISSIONS, PERMISSION_KEYS, SYSTEM_ROLES, splitPermission } from '@ucrams/shared';
import { prisma } from '../../infrastructure/database/prisma.js';

/**
 * Makes the database match the permission catalogue and ensures system roles
 * exist. Idempotent; safe on every deploy.
 *
 * - Permissions: upserted from the shared catalogue (descriptions kept current).
 * - System roles: created with their default permissions when missing. Existing
 *   roles keep their current permissions, so changes made through the RBAC UI
 *   survive; pass `resetSystemRoles` to restore the defaults (development only).
 */
export async function syncRbacCatalog(options: { resetSystemRoles?: boolean } = {}) {
  for (const key of PERMISSION_KEYS) {
    const { resource, action } = splitPermission(key);
    await prisma.permission.upsert({
      where: { key },
      create: { key, resource, action, description: PERMISSIONS[key] },
      update: { resource, action, description: PERMISSIONS[key] },
    });
  }
  const permissionIds = new Map(
    (await prisma.permission.findMany({ select: { id: true, key: true } })).map((p) => [
      p.key,
      p.id,
    ]),
  );

  let created = 0;
  for (const def of SYSTEM_ROLES) {
    const existing = await prisma.role.findUnique({ where: { key: def.key } });
    const data = def.permissions.map((k) => ({ permissionId: permissionIds.get(k)! }));
    if (!existing) {
      await prisma.role.create({
        data: {
          key: def.key,
          name: def.name,
          description: def.description,
          isSystem: true,
          scopeMode: def.scopeMode,
          permissions: { create: data },
        },
      });
      created += 1;
      continue;
    }
    // Scope semantics and system status of system roles are fixed by code, never by the UI.
    if (existing.scopeMode !== def.scopeMode || !existing.isSystem) {
      await prisma.role.update({
        where: { id: existing.id },
        data: { scopeMode: def.scopeMode, isSystem: true },
      });
    }
    if (options.resetSystemRoles) {
      await prisma.$transaction([
        prisma.role.update({
          where: { id: existing.id },
          data: { name: def.name, description: def.description },
        }),
        prisma.rolePermission.deleteMany({ where: { roleId: existing.id } }),
        prisma.rolePermission.createMany({
          data: data.map((d) => ({ ...d, roleId: existing.id })),
        }),
      ]);
    }
  }
  return { permissions: PERMISSION_KEYS.length, rolesCreated: created };
}
