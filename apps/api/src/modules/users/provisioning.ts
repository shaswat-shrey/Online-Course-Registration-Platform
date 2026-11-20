import { ErrorCode, type RoleKey } from '@ucrams/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { ConflictError } from '../../common/exceptions/app-error.js';
import { issueInvitation } from '../auth/auth.service.js';

type Tx = Prisma.TransactionClient;

export const emailTaken = () =>
  new ConflictError(ErrorCode.UNIQUE_VIOLATION, 'An account with this email already exists', {
    fields: [{ path: 'body.email', message: 'Already in use' }],
  });

/**
 * Creates an invited (password-less) account with one role assignment. Call
 * inside the transaction that creates the profile so both commit together.
 */
export async function createInvitedUser(
  tx: Tx,
  input: {
    email: string;
    firstName: string;
    lastName: string;
    role:
      | RoleKey
      | { roleId: string; scopeType: 'GLOBAL' | 'SCHOOL' | 'DEPARTMENT'; scopeId: string | null };
    assignedById: string;
  },
) {
  if (await tx.user.findUnique({ where: { email: input.email }, select: { id: true } }))
    throw emailTaken();
  const role =
    typeof input.role === 'string'
      ? {
          roleId: (await tx.role.findUniqueOrThrow({ where: { key: input.role } })).id,
          scopeType: 'GLOBAL' as const,
          scopeId: null,
        }
      : input.role;
  return tx.user.create({
    data: {
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      status: 'INVITED',
      roles: { create: { ...role, assignedById: input.assignedById } },
    },
  });
}

/** Sends invitations after commit; failures are logged by the email outbox, never thrown. */
export async function sendInvitations(userIds: string[]): Promise<void> {
  for (const id of userIds) {
    await issueInvitation(id).catch(() => undefined);
  }
}

export function displayName(u: { firstName: string; lastName: string }) {
  return `${u.firstName} ${u.lastName}`;
}
