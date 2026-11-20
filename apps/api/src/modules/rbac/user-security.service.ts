import type { ActorContext } from '../../common/context/actor.js';
import { NotFoundError } from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import { assertGlobal } from '../authz/authz.js';
import { loginHistory, toSessionDtos } from '../auth/auth.service.js';
import { listActiveSessions, revokeSessions } from '../auth/session.service.js';

/*
 * Administrative account-security actions. Users have no school/department until
 * student and faculty profiles exist, so these require a university-wide grant
 * for now; profile-based scoping is added with user management.
 */

async function assertUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new NotFoundError('User');
}

export async function adminListSessions(actor: ActorContext, userId: string) {
  assertGlobal(actor, 'user:read_sessions');
  await assertUser(userId);
  return toSessionDtos(await listActiveSessions(userId));
}

export async function adminLoginHistory(actor: ActorContext, userId: string) {
  assertGlobal(actor, 'user:read_sessions');
  await assertUser(userId);
  return loginHistory(userId, 100);
}

export async function adminRevokeSessions(actor: ActorContext, userId: string): Promise<number> {
  assertGlobal(actor, 'user:revoke_sessions');
  await assertUser(userId);
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
  assertGlobal(actor, 'user:manage_status');
  await assertUser(userId);
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
