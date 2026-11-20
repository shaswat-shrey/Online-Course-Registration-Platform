import {
  ErrorCode,
  RoleKey,
  type AcceptInviteInput,
  type ChangePasswordInput,
  type LoginAttemptDto,
  type LoginInput,
  type MeDto,
  type Portal,
  type ResetPasswordInput,
  type SessionDto,
} from '@ucrams/shared';
import type { ActorContext, RequestMeta } from '../../common/context/actor.js';
import {
  AppError,
  BusinessRuleError,
  NotFoundError,
  UnauthenticatedError,
} from '../../common/exceptions/app-error.js';
import { env } from '../../config/env.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { enqueueEmail } from '../../infrastructure/email/outbox.js';
import {
  invitationEmail,
  passwordChangedEmail,
  passwordResetEmail,
} from '../../infrastructure/email/templates.js';
import { recordAudit } from '../audit/audit.service.js';
import { getAuthState, invalidateAuthState, permissionList } from '../authz/grants.service.js';
import { describeUserAgent } from './device.js';
import {
  assertPasswordPolicy,
  dummyVerify,
  hashPassword,
  needsRehash,
  verifyPassword,
} from './password.js';
import {
  createSession,
  listActiveSessions,
  revokeSessions,
  rotateRefreshToken,
  findSessionByRefreshToken,
} from './session.service.js';
import { generateToken, hashToken, signAccessToken } from './tokens.js';

const invalidCredentials = () =>
  new UnauthenticatedError(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken?: string;
  refreshExpiresAt?: Date;
}

async function issueAccessToken(userId: string, sessionId: string) {
  const state = await getAuthState(userId);
  if (!state) throw invalidCredentials();
  const { token, expiresAt } = await signAccessToken({
    sub: userId,
    sid: sessionId,
    pv: state.permissionsVersion,
  });
  return { accessToken: token, accessTokenExpiresAt: expiresAt };
}

function lockDurationMs(lockoutCount: number): number {
  const minutes = Math.min(
    env.LOCKOUT_BASE_MINUTES * 2 ** Math.max(0, lockoutCount - 1),
    env.LOCKOUT_MAX_MINUTES,
  );
  return minutes * 60_000;
}

async function recordAttempt(
  userId: string | null,
  outcome: 'SUCCESS' | 'INVALID_CREDENTIALS' | 'UNKNOWN_USER' | 'LOCKED' | 'INACTIVE',
  meta: RequestMeta,
) {
  await prisma.loginAttempt.create({
    data: { userId, outcome, ip: meta.ip, userAgent: meta.userAgent },
  });
}

/**
 * Login (FR-AUTH-001, 011, 012). Unknown email and wrong password are
 * indistinguishable; lock state and inactive status are only revealed after the
 * correct password was supplied (SECURITY.md §2).
 */
export async function login(input: Required<LoginInput>, meta: RequestMeta) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user?.passwordHash) {
    await dummyVerify(input.password);
    await recordAttempt(user?.id ?? null, 'UNKNOWN_USER', meta);
    throw invalidCredentials();
  }

  const valid = await verifyPassword(user.passwordHash, input.password);
  const now = new Date();

  if (user.lockedUntil && user.lockedUntil > now) {
    await recordAttempt(user.id, 'LOCKED', meta);
    if (!valid) throw invalidCredentials();
    const retryAfter = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000);
    throw new AppError(
      423,
      ErrorCode.ACCOUNT_LOCKED,
      'This account is temporarily locked. Try again later.',
      {
        details: { retryAfterSeconds: retryAfter },
        headers: { 'Retry-After': String(retryAfter) },
      },
    );
  }

  if (!valid) {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true, lockoutCount: true },
    });
    if (updated.failedLoginCount >= env.LOCKOUT_THRESHOLD) {
      const lockoutCount = updated.lockoutCount + 1;
      const lockedUntil = new Date(now.getTime() + lockDurationMs(lockoutCount));
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockoutCount, lockedUntil },
      });
      await recordAudit(
        { ...meta, userId: user.id },
        {
          action: 'auth.account_locked',
          entityType: 'User',
          entityId: user.id,
          changes: { lockedUntil: lockedUntil.toISOString(), lockoutCount },
        },
      );
    }
    await recordAttempt(user.id, 'INVALID_CREDENTIALS', meta);
    throw invalidCredentials();
  }

  if (user.status !== 'ACTIVE') {
    await recordAttempt(user.id, 'INACTIVE', meta);
    throw new AppError(
      403,
      ErrorCode.ACCOUNT_INACTIVE,
      'This account is not active. Contact the administration office.',
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: 0,
      lockoutCount: 0,
      lockedUntil: null,
      lastLoginAt: now,
      ...(needsRehash(user.passwordHash)
        ? { passwordHash: await hashPassword(input.password) }
        : {}),
    },
  });
  await recordAttempt(user.id, 'SUCCESS', meta);
  const session = await createSession(user.id, input.rememberMe, meta);
  const access = await issueAccessToken(user.id, session.sessionId);
  const me = await getMe(user.id, session.sessionId);
  return { ...access, refreshToken: session.refreshToken, refreshExpiresAt: session.expiresAt, me };
}

export async function refresh(
  presentedToken: string | undefined,
  meta: RequestMeta,
): Promise<IssuedTokens> {
  if (!presentedToken)
    throw new UnauthenticatedError(ErrorCode.SESSION_REVOKED, 'No active session');
  const result = await rotateRefreshToken(presentedToken, meta);
  const access = await issueAccessToken(result.userId, result.sessionId);
  if (result.kind === 'grace') return access;
  return { ...access, refreshToken: result.refreshToken, refreshExpiresAt: result.expiresAt };
}

/** Logout is idempotent: an unknown or already-revoked token still clears cookies. */
export async function logout(presentedToken: string | undefined, meta: RequestMeta): Promise<void> {
  if (!presentedToken) return;
  const session = await findSessionByRefreshToken(presentedToken);
  if (!session || session.revokedAt) return;
  await revokeSessions({ userId: session.userId, ids: [session.id] }, 'LOGOUT');
  await recordAudit(
    { ...meta, userId: session.userId },
    { action: 'auth.logout', entityType: 'Session', entityId: session.id },
  );
}

export async function logoutAll(actor: ActorContext): Promise<number> {
  const count = await revokeSessions({ userId: actor.userId }, 'LOGOUT_ALL');
  await recordAudit(actor, {
    action: 'auth.logout_all',
    entityType: 'User',
    entityId: actor.userId,
    changes: { sessionsRevoked: count },
  });
  return count;
}

function portalsFor(roleKeys: string[], permissions: string[]): Portal[] {
  const portals: Portal[] = [];
  if (permissions.includes('dashboard:admin')) portals.push('admin');
  if (roleKeys.includes(RoleKey.FACULTY)) portals.push('faculty');
  if (roleKeys.includes(RoleKey.STUDENT)) portals.push('student');
  return portals;
}

export async function getMe(userId: string, sessionId: string): Promise<MeDto> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      status: true,
      lastLoginAt: true,
      roles: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          scopeType: true,
          scopeId: true,
          role: { select: { key: true, name: true, scopeMode: true } },
        },
      },
    },
  });
  const state = await getAuthState(userId);
  if (!user || !state) throw new NotFoundError('User');
  const permissions = permissionList(state.grants);
  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    },
    roles: user.roles.map((r) => ({
      id: r.id,
      roleKey: r.role.key,
      roleName: r.role.name,
      scopeType: r.scopeType,
      scopeId: r.scopeId,
      scopeMode: r.role.scopeMode,
    })),
    permissions,
    grants: state.grants,
    portals: portalsFor(
      user.roles.map((r) => r.role.key),
      permissions,
    ),
    sessionId,
  };
}

export async function listSessions(actor: ActorContext): Promise<SessionDto[]> {
  return toSessionDtos(await listActiveSessions(actor.userId), actor.sessionId);
}

export function toSessionDtos(
  rows: Awaited<ReturnType<typeof listActiveSessions>>,
  currentId?: string,
): SessionDto[] {
  return rows.map((s) => ({
    id: s.id,
    deviceLabel: s.deviceLabel,
    ip: s.ip,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    current: s.id === currentId,
  }));
}

export async function revokeOwnSession(actor: ActorContext, sessionId: string): Promise<void> {
  const count = await revokeSessions({ userId: actor.userId, ids: [sessionId] }, 'USER_REVOKED');
  if (count === 0) throw new NotFoundError('Session');
  await recordAudit(actor, {
    action: 'auth.session_revoked',
    entityType: 'Session',
    entityId: sessionId,
  });
}

export async function loginHistory(userId: string, limit = 50): Promise<LoginAttemptDto[]> {
  const rows = await prisma.loginAttempt.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id.toString(),
    outcome: r.outcome,
    ip: r.ip,
    deviceLabel: describeUserAgent(r.userAgent),
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Always resolves identically, whether or not the account exists (FR-AUTH-013). */
export async function forgotPassword(email: string, meta: RequestMeta): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, firstName: true, status: true },
  });
  if (!user || user.status !== 'ACTIVE') return;
  const token = generateToken();
  await prisma.$transaction([
    prisma.authToken.updateMany({
      where: { userId: user.id, type: 'PASSWORD_RESET', usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.authToken.create({
      data: {
        userId: user.id,
        type: 'PASSWORD_RESET',
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + env.RESET_TOKEN_TTL_MINUTES * 60_000),
      },
    }),
  ]);
  const url = `${env.WEB_APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await enqueueEmail(
    passwordResetEmail(user.email, user.firstName, url, env.RESET_TOKEN_TTL_MINUTES),
    'password-reset',
  );
  await recordAudit(
    { ...meta, userId: null },
    { action: 'auth.password_reset_requested', entityType: 'User', entityId: user.id },
  );
}

/** Consumes a single-use token atomically; returns its user or throws a generic error. */
async function consumeToken(token: string, type: 'PASSWORD_RESET' | 'EMAIL_VERIFY') {
  const record = await prisma.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
  const invalid = new BusinessRuleError(
    ErrorCode.VALIDATION_ERROR,
    'This link is invalid or has expired. Request a new one.',
  );
  if (!record || record.type !== type || record.usedAt || record.expiresAt < new Date())
    throw invalid;
  const claim = await prisma.authToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claim.count === 0) throw invalid;
  const user = await prisma.user.findUnique({ where: { id: record.userId } });
  if (!user) throw invalid;
  return user;
}

export async function resetPassword(input: ResetPasswordInput, meta: RequestMeta): Promise<void> {
  const user = await consumeToken(input.token, 'PASSWORD_RESET');
  if (user.status !== 'ACTIVE') {
    throw new BusinessRuleError(
      ErrorCode.VALIDATION_ERROR,
      'This link is invalid or has expired. Request a new one.',
    );
  }
  assertPasswordPolicy(input.password, user.email);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(input.password),
      passwordChangedAt: new Date(),
      failedLoginCount: 0,
      lockoutCount: 0,
      lockedUntil: null,
    },
  });
  await revokeSessions({ userId: user.id }, 'PASSWORD_RESET');
  await recordAudit(
    { ...meta, userId: user.id },
    { action: 'auth.password_reset', entityType: 'User', entityId: user.id },
  );
  await enqueueEmail(passwordChangedEmail(user.email, user.firstName), 'password-changed');
}

/**
 * Creates an invitation token and emails it (FR-AUTH-016). Used by user
 * provisioning (Phase 4) and bulk imports; returns the raw token for tests only.
 */
export async function issueInvitation(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('User');
  if (user.status !== 'INVITED') {
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      'This account has already been activated',
    );
  }
  const token = generateToken();
  await prisma.$transaction([
    prisma.authToken.updateMany({
      where: { userId, type: 'EMAIL_VERIFY', usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.authToken.create({
      data: {
        userId,
        type: 'EMAIL_VERIFY',
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + env.INVITE_TOKEN_TTL_HOURS * 3600_000),
      },
    }),
  ]);
  const url = `${env.WEB_APP_URL}/accept-invite?token=${encodeURIComponent(token)}`;
  await enqueueEmail(
    invitationEmail(user.email, user.firstName, url, env.INVITE_TOKEN_TTL_HOURS),
    'invitation',
  );
  return token;
}

export async function acceptInvitation(input: AcceptInviteInput, meta: RequestMeta): Promise<void> {
  const user = await consumeToken(input.token, 'EMAIL_VERIFY');
  if (user.status !== 'INVITED') {
    throw new BusinessRuleError(
      ErrorCode.VALIDATION_ERROR,
      'This link is invalid or has expired. Request a new one.',
    );
  }
  assertPasswordPolicy(input.password, user.email);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(input.password),
      passwordChangedAt: new Date(),
      emailVerifiedAt: new Date(),
      status: 'ACTIVE',
    },
  });
  await invalidateAuthState([user.id]);
  await recordAudit(
    { ...meta, userId: user.id },
    { action: 'auth.invitation_accepted', entityType: 'User', entityId: user.id },
  );
}

export async function changePassword(
  actor: ActorContext,
  input: ChangePasswordInput,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: actor.userId } });
  if (!user?.passwordHash) throw new NotFoundError('User');
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw new BusinessRuleError(ErrorCode.INVALID_CREDENTIALS, 'Current password is incorrect', {
      fields: [{ path: 'body.currentPassword', message: 'Current password is incorrect' }],
    });
  }
  assertPasswordPolicy(input.newPassword, user.email);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(input.newPassword), passwordChangedAt: new Date() },
  });
  const revoked = await revokeSessions(
    { userId: user.id, exceptId: actor.sessionId },
    'PASSWORD_CHANGED',
  );
  await recordAudit(actor, {
    action: 'auth.password_changed',
    entityType: 'User',
    entityId: user.id,
    changes: { otherSessionsRevoked: revoked },
  });
  await enqueueEmail(passwordChangedEmail(user.email, user.firstName), 'password-changed');
}
