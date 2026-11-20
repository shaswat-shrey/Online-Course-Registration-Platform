import type { z } from 'zod';
import type { adminCreateSchema, adminUpdateSchema } from '@ucrams/shared';
import type { ActorContext } from '../../common/context/actor.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../common/exceptions/app-error.js';
import { ErrorCode } from '@ucrams/shared';
import { paging } from '../../common/http/list-query.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { diffChanges, recordAudit } from '../audit/audit.service.js';
import { assertGlobal } from '../authz/authz.js';
import { avatarUrl } from '../files/files.service.js';
import { assertCanAssign, roleForAssignment, scopeNames } from '../rbac/rbac.service.js';
import { resolveScope } from '../rbac/scope-resolver.js';
import { createInvitedUser, sendInvitations } from '../users/provisioning.js';
import { accountSummary } from '../users/users.service.js';

/** Administrators: users holding an organisational role, or with an admin profile. */
const adminWhere = {
  OR: [
    { adminProfile: { isNot: null } },
    { roles: { some: { role: { scopeMode: 'ORGANIZATIONAL' as const } } } },
  ],
};

const include = {
  adminProfile: { include: { officeDepartment: { select: { id: true, name: true } } } },
  roles: {
    where: { role: { scopeMode: 'ORGANIZATIONAL' as const } },
    select: {
      id: true,
      scopeType: true,
      scopeId: true,
      role: { select: { id: true, key: true, name: true } },
    },
  },
} as const;

export async function listAdministrators(
  actor: ActorContext,
  q: { page: number; limit: number; q?: string; status?: string },
) {
  assertGlobal(actor, 'admin:manage');
  const where = {
    AND: [
      adminWhere,
      q.q
        ? {
            OR: [
              { email: { contains: q.q, mode: 'insensitive' as const } },
              { firstName: { contains: q.q, mode: 'insensitive' as const } },
              { lastName: { contains: q.q, mode: 'insensitive' as const } },
            ],
          }
        : {},
      q.status ? { status: q.status as never } : {},
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      ...paging(q),
    }),
  ]);
  const nameOf = await scopeNames(rows.flatMap((r) => r.roles));
  return {
    total,
    items: rows.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      status: u.status,
      jobTitle: u.adminProfile?.jobTitle ?? null,
      roles: u.roles.map((r) => ({
        id: r.id,
        roleKey: r.role.key,
        roleName: r.role.name,
        scopeType: r.scopeType,
        scopeName: nameOf(r),
      })),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    })),
  };
}

export async function getAdministrator(actor: ActorContext, userId: string) {
  assertGlobal(actor, 'admin:manage');
  const u = await prisma.user.findFirst({ where: { id: userId, ...adminWhere }, include });
  if (!u) throw new NotFoundError('Administrator');
  const nameOf = await scopeNames(u.roles);
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    avatarUrl: await avatarUrl(u.avatarFileId),
    jobTitle: u.adminProfile?.jobTitle ?? null,
    employeeNumber: u.adminProfile?.employeeNumber ?? null,
    phone: u.adminProfile?.phone ?? null,
    officeDepartment: u.adminProfile?.officeDepartment ?? null,
    roles: u.roles.map((r) => ({
      id: r.id,
      roleKey: r.role.key,
      roleName: r.role.name,
      scopeType: r.scopeType,
      scopeName: nameOf(r),
    })),
    account: await accountSummary(u.id),
  };
}

/**
 * Creates an invited administrator with one organisational role. The same
 * escalation guard as role assignment applies before anything is written.
 */
export async function createAdministrator(
  actor: ActorContext,
  input: z.output<typeof adminCreateSchema>,
) {
  assertGlobal(actor, 'admin:manage');
  const role = await roleForAssignment(input.roleId);
  if (role.scopeMode !== 'ORGANIZATIONAL') {
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Choose an administrative role', {
      fields: [
        {
          path: 'body.roleId',
          message: 'Faculty and student roles are given through their records',
        },
      ],
    });
  }
  const scope =
    input.scopeType === 'GLOBAL'
      ? { scopeType: 'GLOBAL' as const }
      : { scopeType: input.scopeType, scopeId: input.scopeId! };
  const target = await resolveScope(scope);
  assertCanAssign(actor, role, target);
  if (
    input.employeeNumber &&
    (await prisma.adminProfile.findUnique({ where: { employeeNumber: input.employeeNumber } }))
  ) {
    throw new ConflictError(ErrorCode.UNIQUE_VIOLATION, 'This employee number is already used', {
      fields: [{ path: 'body.employeeNumber', message: 'Already in use' }],
    });
  }
  const user = await prisma.$transaction(async (tx) => {
    const u = await createInvitedUser(tx, {
      ...input,
      role: {
        roleId: input.roleId,
        scopeType: input.scopeType,
        scopeId: input.scopeType === 'GLOBAL' ? null : input.scopeId,
      },
      assignedById: actor.userId,
    });
    await tx.adminProfile.create({
      data: {
        userId: u.id,
        jobTitle: input.jobTitle,
        employeeNumber: input.employeeNumber,
        phone: input.phone,
        officeDepartmentId: input.officeDepartmentId,
      },
    });
    await recordAudit(
      actor,
      {
        action: 'admin.created',
        entityType: 'User',
        entityId: u.id,
        changes: {
          email: input.email,
          role: role.key,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
        },
      },
      tx,
    );
    return u;
  });
  if (input.sendInvite) await sendInvitations([user.id]);
  return getAdministrator(actor, user.id);
}

export async function updateAdministrator(
  actor: ActorContext,
  userId: string,
  input: z.output<typeof adminUpdateSchema>,
) {
  assertGlobal(actor, 'admin:manage');
  const before = await prisma.user.findFirst({
    where: { id: userId, ...adminWhere },
    include: { adminProfile: true },
  });
  if (!before) throw new NotFoundError('Administrator');
  const { firstName, lastName, ...profile } = input;
  await prisma.$transaction(async (tx) => {
    if (firstName || lastName)
      await tx.user.update({ where: { id: userId }, data: { firstName, lastName } });
    const after = await tx.adminProfile.upsert({
      where: { userId },
      create: { userId, ...profile },
      update: profile,
    });
    await recordAudit(
      actor,
      {
        action: 'admin.updated',
        entityType: 'User',
        entityId: userId,
        changes: diffChanges(before.adminProfile ?? {}, after) as never,
      },
      tx,
    );
  });
  return getAdministrator(actor, userId);
}
