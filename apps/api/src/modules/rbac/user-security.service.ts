import type { ActorContext } from '../../common/context/actor.js';
import { NotFoundError } from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import { assertUserInScope } from '../users/user-scope.js';
import { loginHistory, toSessionDtos } from '../auth/auth.service.js';
import { listActiveSessions, revokeSessions } from '../auth/session.service.js';

/*
 * Administrative account-security actions, scoped through the user's student or
 * faculty department (users without one need a university-wide grant).
 */

async function assertUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new NotFoundError('User');
}

export async function adminListSessions(actor: ActorContext, userId: string) {
  await assertUser(userId);
  await assertUserInScope(actor, 'user:read_sessions', userId);
  return toSessionDtos(await listActiveSessions(userId));
}

export async function adminLoginHistory(actor: ActorContext, userId: string) {
  await assertUser(userId);
  await assertUserInScope(actor, 'user:read_sessions', userId);
  return loginHistory(userId, 100);
}

export async function adminRevokeSessions(actor: ActorContext, userId: string): Promise<number> {
  await assertUser(userId);
  await assertUserInScope(actor, 'user:revoke_sessions', userId);
  const count = await revokeSessions({ userId }, 'ADMIN_REVOKED');
  await recordAudit(actor, {
    action: 'auth.sessions_revoked_by_admin',
    entityType: 'User',
    entityId: userId,
    changes: { count },
  });
  return count;
}

export async function adminUnlockUser(actor: ActorContext, userId: string): Promise<void> {
  await assertUser(userId);
  await assertUserInScope(actor, 'user:manage_status', userId);
  await prisma.user.update({
    where: { id: userId },
    data: { lockedUntil: null, failedLoginCount: 0, lockoutCount: 0 },
  });
  await recordAudit(actor, {
    action: 'auth.account_unlocked',
    entityType: 'User',
    entityId: userId,
  });
}
