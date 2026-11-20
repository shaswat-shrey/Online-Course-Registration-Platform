import { isPermissionKey, type PermissionKey } from '@ucrams/shared';
import type { Grant, GrantMap } from '../../common/context/actor.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { redis } from '../../infrastructure/redis/redis.js';

export interface UserAuthState {
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  permissionsVersion: number;
  grants: GrantMap;
}

const CACHE_TTL_SECONDS = 15 * 60;
const cacheKey = (userId: string) => `authz:${userId}`;

function toGrant(scopeType: string, scopeId: string | null, scopeMode: string): Grant {
  if (scopeMode === 'RELATIONSHIP') return { scope: 'OWN' };
  if (scopeType === 'SCHOOL' && scopeId) return { scope: 'SCHOOL', id: scopeId };
  if (scopeType === 'DEPARTMENT' && scopeId) return { scope: 'DEPARTMENT', id: scopeId };
  return { scope: 'GLOBAL' };
}

export async function computeAuthState(userId: string): Promise<UserAuthState | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      status: true,
      permissionsVersion: true,
      roles: {
        select: {
          scopeType: true,
          scopeId: true,
          role: {
            select: {
              scopeMode: true,
              permissions: { select: { permission: { select: { key: true } } } },
            },
          },
        },
      },
    },
  });
  if (!user) return null;
  const grants: GrantMap = {};
  for (const assignment of user.roles) {
    const grant = toGrant(assignment.scopeType, assignment.scopeId, assignment.role.scopeMode);
    for (const { permission } of assignment.role.permissions) {
      if (!isPermissionKey(permission.key)) continue;
      const list = (grants[permission.key as PermissionKey] ??= []);
      if (!list.some((g) => JSON.stringify(g) === JSON.stringify(grant))) list.push(grant);
    }
  }
  return { status: user.status, permissionsVersion: user.permissionsVersion, grants };
}

/** Cached effective grants. Falls back to the database when Redis is unavailable. */
export async function getAuthState(userId: string): Promise<UserAuthState | null> {
  try {
    const cached = await redis.get(cacheKey(userId));
    if (cached) return JSON.parse(cached) as UserAuthState;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'authz cache read failed; using database');
  }
  const state = await computeAuthState(userId);
  if (state) {
    redis
      .set(cacheKey(userId), JSON.stringify(state), 'EX', CACHE_TTL_SECONDS)
      .catch(() => undefined);
  }
  return state;
}

export async function invalidateAuthState(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  try {
    await redis.del(...userIds.map(cacheKey));
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'authz cache invalidation failed');
  }
}

/** Bumps permissionsVersion so outstanding access tokens must refresh, then clears the cache. */
export async function bumpPermissionsVersion(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await prisma.user.updateMany({
    where: { id: { in: userIds } },
    data: { permissionsVersion: { increment: 1 } },
  });
  await invalidateAuthState(userIds);
}

export function permissionList(grants: GrantMap): PermissionKey[] {
  return (Object.keys(grants) as PermissionKey[])
    .filter((k) => (grants[k]?.length ?? 0) > 0)
    .sort();
}
