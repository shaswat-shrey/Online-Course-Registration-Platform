import { createHash } from 'node:crypto';
import { ErrorCode } from '@ucrams/shared';
import type { ActorContext, RequestMeta } from '../../common/context/actor.js';
import {
  AppError,
  BusinessRuleError,
  NotFoundError,
  ServiceUnavailableError,
} from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { redis } from '../../infrastructure/redis/redis.js';
import { recordAudit } from '../audit/audit.service.js';
import { assertUserInScope } from '../users/user-scope.js';
import { getPublicUniversity } from '../university/university.service.js';
import { verifyPassword } from './password.js';
import { generateToken } from './tokens.js';
import {
  decryptSecret,
  encryptSecret,
  newRecoveryCodes,
  newSecret,
  normaliseRecoveryCode,
  otpauthUrl,
  verifyTotp,
} from './totp.js';

const CHALLENGE_TTL_SECONDS = 5 * 60;
const CHALLENGE_MAX_ATTEMPTS = 5;
const challengeKey = (token: string) =>
  `mfa:challenge:${createHash('sha256').update(token).digest('hex')}`;
const hashCode = (code: string) =>
  new Uint8Array(createHash('sha256').update(normaliseRecoveryCode(code)).digest());

const invalidCode = () =>
  new AppError(401, ErrorCode.MFA_INVALID, 'That code is not valid. Try the current code.');

// ----- enrolment ---------------------------------------------------------------------

/** Starts enrolment: a new secret held as pending until the first code confirms it. */
export async function startSetup(actor: ActorContext) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: { email: true, mfaEnabled: true },
  });
  if (user.mfaEnabled)
    throw new BusinessRuleError(ErrorCode.CONFLICT, 'Two-factor sign-in is already on');
  const secret = newSecret();
  await prisma.user.update({
    where: { id: actor.userId },
    data: { mfaPendingSecretEnc: encryptSecret(secret) },
  });
  const issuer = (await getPublicUniversity().catch(() => null))?.shortName ?? 'UCRAMS';
  return { secret, otpauthUrl: otpauthUrl(secret, user.email, issuer) };
}

async function replaceRecoveryCodes(userId: string) {
  const codes = newRecoveryCodes();
  await prisma.$transaction([
    prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
    prisma.mfaRecoveryCode.createMany({
      data: codes.map((c) => ({ userId, codeHash: hashCode(c) })),
    }),
  ]);
  return codes;
}

/** Confirms enrolment with the first code; returns recovery codes (shown once). */
export async function confirmSetup(actor: ActorContext, code: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (user.mfaEnabled)
    throw new BusinessRuleError(ErrorCode.CONFLICT, 'Two-factor sign-in is already on');
  if (!user.mfaPendingSecretEnc)
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Start the setup first');
  const secret = decryptSecret(user.mfaPendingSecretEnc);
  const step = verifyTotp(secret, code, null);
  if (step === null) throw invalidCode();
  await prisma.user.update({
    where: { id: actor.userId },
    data: {
      mfaEnabled: true,
      mfaSecretEnc: user.mfaPendingSecretEnc,
      mfaPendingSecretEnc: null,
      mfaLastStep: step,
    },
  });
  const recoveryCodes = await replaceRecoveryCodes(actor.userId);
  await recordAudit(actor, {
    action: 'auth.mfa_enabled',
    entityType: 'User',
    entityId: actor.userId,
  });
  return { recoveryCodes };
}

/**
 * Checks a TOTP or a recovery code for a user with two-factor sign-in on.
 * Accepted TOTP steps and recovery codes are consumed.
 */
async function consumeCode(userId: string, code: string): Promise<'totp' | 'recovery' | null> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { mfaSecretEnc: true, mfaLastStep: true },
  });
  if (!user.mfaSecretEnc) return null;
  if (/^\d{6}$/.test(code.trim())) {
    const step = verifyTotp(decryptSecret(user.mfaSecretEnc), code.trim(), user.mfaLastStep);
    if (step === null) return null;
    // Conditional update: two parallel requests with the same code cannot both win.
    const won = await prisma.user.updateMany({
      where: {
        id: userId,
        OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }],
      },
      data: { mfaLastStep: step },
    });
    return won.count ? 'totp' : null;
  }
  const used = await prisma.mfaRecoveryCode.updateMany({
    where: { userId, codeHash: hashCode(code), usedAt: null },
    data: { usedAt: new Date() },
  });
  return used.count ? 'recovery' : null;
}

export async function disable(actor: ActorContext, password: string, code: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!user.mfaEnabled) return;
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, password)))
    throw new AppError(401, ErrorCode.INVALID_CREDENTIALS, 'The password is incorrect');
  if (!(await consumeCode(actor.userId, code))) throw invalidCode();
  await clearMfa(actor.userId);
  await recordAudit(actor, {
    action: 'auth.mfa_disabled',
    entityType: 'User',
    entityId: actor.userId,
  });
}

async function clearMfa(userId: string) {
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaLastStep: null },
    }),
    prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
  ]);
}

export async function regenerateRecoveryCodes(actor: ActorContext, code: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!user.mfaEnabled)
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Two-factor sign-in is off');
  if ((await consumeCode(actor.userId, code)) !== 'totp') throw invalidCode();
  const recoveryCodes = await replaceRecoveryCodes(actor.userId);
  await recordAudit(actor, {
    action: 'auth.mfa_recovery_regenerated',
    entityType: 'User',
    entityId: actor.userId,
  });
  return { recoveryCodes };
}

export async function status(actor: ActorContext) {
  const [user, remaining] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { mfaEnabled: true },
    }),
    prisma.mfaRecoveryCode.count({ where: { userId: actor.userId, usedAt: null } }),
  ]);
  return { enabled: user.mfaEnabled, recoveryCodesRemaining: user.mfaEnabled ? remaining : 0 };
}

/** Administrators reset two-factor sign-in for someone who lost their device. */
export async function adminReset(actor: ActorContext, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new NotFoundError('User');
  await assertUserInScope(actor, 'user:manage_status', userId);
  await clearMfa(userId);
  // Sessions are kept; the user simply signs in with a password next time and may re-enrol.
  await recordAudit(actor, { action: 'auth.mfa_reset', entityType: 'User', entityId: userId });
}

// ----- sign-in challenge ---------------------------------------------------------------

interface Challenge {
  userId: string;
  rememberMe: boolean;
  attempts: number;
}

/** Issued after a correct password: single use, 5 minutes, at most 5 code attempts. */
export async function createChallenge(userId: string, rememberMe: boolean) {
  const token = generateToken();
  const value: Challenge = { userId, rememberMe, attempts: 0 };
  try {
    await redis.set(challengeKey(token), JSON.stringify(value), 'EX', CHALLENGE_TTL_SECONDS);
  } catch {
    throw new ServiceUnavailableError('Sign-in is temporarily unavailable');
  }
  return {
    mfaRequired: true as const,
    challengeToken: token,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString(),
  };
}

/** Resolves a challenge with a code; returns the user and the remember-me choice. */
export async function completeChallenge(token: string, code: string, meta: RequestMeta) {
  const key = challengeKey(token);
  const raw = await redis.get(key).catch(() => {
    throw new ServiceUnavailableError('Sign-in is temporarily unavailable');
  });
  if (!raw)
    throw new AppError(401, ErrorCode.MFA_CHALLENGE_EXPIRED, 'The sign-in expired. Start again.');
  const challenge = JSON.parse(raw) as Challenge;
  const kind = await consumeCode(challenge.userId, code);
  if (!kind) {
    challenge.attempts++;
    await prisma.loginAttempt.create({
      data: {
        userId: challenge.userId,
        outcome: 'MFA_FAILED',
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    if (challenge.attempts >= CHALLENGE_MAX_ATTEMPTS) await redis.del(key);
    else await redis.set(key, JSON.stringify(challenge), 'KEEPTTL');
    throw invalidCode();
  }
  await redis.del(key);
  if (kind === 'recovery')
    await recordAudit(
      { ...meta, userId: challenge.userId },
      { action: 'auth.mfa_recovery_used', entityType: 'User', entityId: challenge.userId },
    );
  return challenge;
}
