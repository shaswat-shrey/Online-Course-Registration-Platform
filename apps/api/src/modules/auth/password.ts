import argon2 from 'argon2';
import { ErrorCode } from '@ucrams/shared';
import { BusinessRuleError } from '../../common/exceptions/app-error.js';
import { env } from '../../config/env.js';
import { COMMON_PASSWORDS } from './common-passwords.js';

const options = {
  type: argon2.argon2id,
  memoryCost: env.ARGON2_MEMORY_KIB,
  timeCost: env.ARGON2_TIME_COST,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, options);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function needsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, options);
}

let dummyHash: Promise<string> | undefined;

/**
 * Performs a full hash verification against a throwaway hash so login timing is
 * the same for unknown accounts and wrong passwords (SECURITY.md §2).
 */
export async function dummyVerify(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalization');
  await verifyPassword(await dummyHash, password);
}

/** Policy beyond length (FR-AUTH-003): not a common password, not derived from the email. */
export function assertPasswordPolicy(password: string, email: string): void {
  const lower = password.toLowerCase();
  const localPart = email.toLowerCase().split('@')[0] ?? '';
  const problems: string[] = [];
  if (COMMON_PASSWORDS.has(lower)) problems.push('This password is too common');
  if (lower === email.toLowerCase() || (localPart.length >= 4 && lower.includes(localPart))) {
    problems.push('Password must not contain your email address');
  }
  if (new Set(lower).size < 4) problems.push('Password must use at least 4 different characters');
  if (problems.length > 0) {
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, problems[0]!, {
      fields: problems.map((message) => ({ path: 'body.password', message })),
    });
  }
}
