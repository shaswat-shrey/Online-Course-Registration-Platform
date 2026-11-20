import { ErrorCode, RoleKey, type accountStatusSchema } from '@ucrams/shared';
import type { z } from 'zod';
import type { ActorContext } from '../../common/context/actor.js';
import { BusinessRuleError, NotFoundError } from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import { issueInvitation } from '../auth/auth.service.js';
import { revokeSessions } from '../auth/session.service.js';
import { invalidateAuthState } from '../authz/grants.service.js';
import { assertUserInScope } from './user-scope.js';

/**
 * Account status (FR-USER-001, FR-AUTH-018). Suspending or deactivating revokes
 * every session immediately. Invited accounts become active only by accepting
 * their invitation.
 */
export async function setAccountStatus(
  actor: ActorContext,
  userId: string,
  input: z.output<typeof accountStatusSchema>,
) {
  await assertUserInScope(actor, 'user:manage_status', userId);
  if (userId === actor.userId) {
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      'You cannot change the status of your own account',
    );
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('User');
  if (user.status === input.status) return { status: user.status };
  if (user.status === 'INVITED' && input.status === 'ACTIVE') {
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      'Invited accounts become active when the invitation is accepted',
    );
  }
  if (input.status !== 'ACTIVE') {
    const isSuper = await prisma.userRole.count({
      where: { userId, role: { key: RoleKey.SUPER_ADMIN } },
    });
    const others = await prisma.userRole.count({
      where: {
        role: { key: RoleKey.SUPER_ADMIN },
        userId: { not: userId },
        user: { status: 'ACTIVE' },
      },
    });
    if (isSuper && others === 0) {
      throw new BusinessRuleError(
        ErrorCode.INVALID_STATE_TRANSITION,
        'At least one active Super Administrator must remain',
      );
    }
  }
  // Re-activating a never-activated account returns it to INVITED.
  const next = input.status === 'ACTIVE' && !user.passwordHash ? 'INVITED' : input.status;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { status: next } });
    await recordAudit(
      actor,
      {
        action: 'user.status_changed',
        entityType: 'User',
        entityId: userId,
        changes: { from: user.status, to: next, reason: input.reason },
      },
      tx,
    );
  });
  if (next !== 'ACTIVE' && next !== 'INVITED') await revokeSessions({ userId }, 'ACCOUNT_INACTIVE');
  await invalidateAuthState([userId]);
  return { status: next };
}

export async function resendInvitation(actor: ActorContext, userId: string) {
  await assertUserInScope(actor, 'user:create', userId);
  await issueInvitation(userId);
  await recordAudit(actor, {
    action: 'user.invitation_resent',
    entityType: 'User',
    entityId: userId,
  });
}

/** Account block shared by student, faculty and admin detail responses. */
export async function accountSummary(userId: string) {
  const [user, activeSessions] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        status: true,
        lastLoginAt: true,
        lockedUntil: true,
        emailVerifiedAt: true,
        createdAt: true,
      },
    }),
    prisma.session.count({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  return {
    status: user.status,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    locked: !!user.lockedUntil && user.lockedUntil > new Date(),
    activated: !!user.emailVerifiedAt,
    activeSessions,
    createdAt: user.createdAt.toISOString(),
  };
}
