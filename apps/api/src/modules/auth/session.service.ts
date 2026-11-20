import { ErrorCode } from '@ucrams/shared';
import type { RequestMeta } from '../../common/context/actor.js';
import { UnauthenticatedError } from '../../common/exceptions/app-error.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { redis } from '../../infrastructure/redis/redis.js';
import { recordAudit } from '../audit/audit.service.js';
import { describeUserAgent } from './device.js';
import { generateToken, hashToken } from './tokens.js';

const DAY_MS = 24 * 3600 * 1000;
const revokedKey = (sessionId: string) => `auth:revoked:${sessionId}`;

export type RevokeReason =
  | 'LOGOUT'
  | 'LOGOUT_ALL'
  | 'USER_REVOKED'
  | 'ADMIN_REVOKED'
  | 'TOKEN_REUSE'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET'
  | 'ACCOUNT_INACTIVE';

function refreshLifetimeMs(rememberMe: boolean): number {
  return (rememberMe ? env.REFRESH_REMEMBER_TTL_DAYS : env.REFRESH_TTL_DAYS) * DAY_MS;
}

export interface IssuedRefresh {
  sessionId: string;
  refreshToken: string;
  expiresAt: Date;
}

export async function createSession(
  userId: string,
  rememberMe: boolean,
  meta: RequestMeta,
): Promise<IssuedRefresh> {
  const refreshToken = generateToken();
  const expiresAt = new Date(Date.now() + refreshLifetimeMs(rememberMe));
  const session = await prisma.session.create({
    data: {
      userId,
      rememberMe,
      ip: meta.ip,
      userAgent: meta.userAgent,
      deviceLabel: describeUserAgent(meta.userAgent),
      expiresAt,
      refreshTokens: { create: { tokenHash: hashToken(refreshToken), expiresAt } },
    },
  });
  return { sessionId: session.id, refreshToken, expiresAt };
}

/** Marks sessions revoked in Redis so access tokens die before they expire (ARCHITECTURE.md §6). */
async function cacheRevoked(sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return;
  try {
    const pipeline = redis.pipeline();
    for (const id of sessionIds)
      pipeline.set(revokedKey(id), '1', 'EX', env.JWT_ACCESS_TTL_SECONDS + 60);
    await pipeline.exec();
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Failed to cache revoked sessions');
  }
}

export async function revokeSessions(
  where: { userId: string; ids?: string[]; exceptId?: string },
  reason: RevokeReason,
) {
  const sessions = await prisma.session.findMany({
    where: {
      userId: where.userId,
      revokedAt: null,
      ...(where.ids ? { id: { in: where.ids } } : {}),
      ...(where.exceptId ? { id: { not: where.exceptId } } : {}),
    },
    select: { id: true },
  });
  const ids = sessions.map((s) => s.id);
  if (ids.length === 0) return 0;
  await prisma.session.updateMany({
    where: { id: { in: ids } },
    data: { revokedAt: new Date(), revokeReason: reason },
  });
  await cacheRevoked(ids);
  return ids.length;
}

/**
 * True if the session must be rejected. Uses the Redis revocation list; if Redis
 * is unreachable, falls back to the database (NFR-AVAIL-002).
 */
export async function isSessionRevoked(sessionId: string): Promise<boolean> {
  try {
    return (await redis.exists(revokedKey(sessionId))) === 1;
  } catch {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { revokedAt: true, expiresAt: true },
    });
    return !session || session.revokedAt !== null || session.expiresAt < new Date();
  }
}

export type RotationResult =
  | { kind: 'rotated'; userId: string; sessionId: string; refreshToken: string; expiresAt: Date }
  /** Concurrent refresh within the grace window: new access token, cookie already rotated. */
  | { kind: 'grace'; userId: string; sessionId: string };

const sessionRevoked = () =>
  new UnauthenticatedError(
    ErrorCode.SESSION_REVOKED,
    'Your session has ended. Please sign in again.',
  );

/**
 * Refresh-token rotation with reuse detection (FR-AUTH-006/007). The claim is an
 * atomic conditional update, so two concurrent refreshes cannot both rotate.
 */
export async function rotateRefreshToken(
  presented: string,
  meta: RequestMeta,
): Promise<RotationResult> {
  const now = new Date();
  const token = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(presented) },
    include: { session: { include: { user: { select: { id: true, status: true } } } } },
  });
  if (!token) throw sessionRevoked();
  const { session } = token;

  if (session.revokedAt || session.expiresAt < now || token.expiresAt < now) throw sessionRevoked();
  if (session.user.status !== 'ACTIVE') {
    await revokeSessions({ userId: session.userId, ids: [session.id] }, 'ACCOUNT_INACTIVE');
    throw sessionRevoked();
  }

  const claim = await prisma.refreshToken.updateMany({
    where: { id: token.id, usedAt: null },
    data: { usedAt: now },
  });
  if (claim.count === 0) {
    const used = await prisma.refreshToken.findUnique({
      where: { id: token.id },
      select: { usedAt: true },
    });
    const graceStart = now.getTime() - env.REFRESH_REUSE_GRACE_SECONDS * 1000;
    if (used?.usedAt && used.usedAt.getTime() >= graceStart) {
      return { kind: 'grace', userId: session.userId, sessionId: session.id };
    }
    await revokeSessions({ userId: session.userId, ids: [session.id] }, 'TOKEN_REUSE');
    await recordAudit(
      { ...meta, userId: session.userId },
      { action: 'auth.refresh_token_reuse', entityType: 'Session', entityId: session.id },
    );
    logger.warn(
      { userId: session.userId, sessionId: session.id },
      'Refresh token reuse detected; session revoked',
    );
    throw sessionRevoked();
  }

  const refreshToken = generateToken();
  const expiresAt = new Date(now.getTime() + refreshLifetimeMs(session.rememberMe));
  await prisma.$transaction(async (tx) => {
    const next = await tx.refreshToken.create({
      data: { sessionId: session.id, tokenHash: hashToken(refreshToken), expiresAt },
    });
    await tx.refreshToken.update({ where: { id: token.id }, data: { replacedById: next.id } });
    await tx.session.update({
      where: { id: session.id },
      data: { lastSeenAt: now, expiresAt, ip: meta.ip, userAgent: meta.userAgent },
    });
  });
  return {
    kind: 'rotated',
    userId: session.userId,
    sessionId: session.id,
    refreshToken,
    expiresAt,
  };
}

/** Resolves the session owning a refresh token without rotating it (logout). */
export async function findSessionByRefreshToken(presented: string) {
  const token = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(presented) },
    select: { session: { select: { id: true, userId: true, revokedAt: true } } },
  });
  return token?.session ?? null;
}

export async function listActiveSessions(userId: string) {
  return prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: {
      id: true,
      deviceLabel: true,
      ip: true,
      createdAt: true,
      lastSeenAt: true,
      expiresAt: true,
    },
  });
}
