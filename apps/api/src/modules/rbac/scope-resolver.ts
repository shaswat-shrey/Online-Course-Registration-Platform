import { ErrorCode } from '@ucrams/shared';
import { BusinessRuleError } from '../../common/exceptions/app-error.js';
import type { ScopeTarget } from '../authz/authz.js';

export type ScopeInput =
  { scopeType: 'GLOBAL'; scopeId?: null } | { scopeType: 'SCHOOL' | 'DEPARTMENT'; scopeId: string };

/**
 * Resolves a role-assignment scope to its organisational location so authorization
 * can check coverage (a SCHOOL grant covers its departments).
 *
 * Schools and departments are introduced with the university structure module;
 * until those tables exist no scoped target can exist, so scoped assignments are
 * rejected as unknown. The structure module replaces this with real lookups.
 */
export async function resolveScope(input: ScopeInput): Promise<ScopeTarget> {
  if (input.scopeType === 'GLOBAL') return {};
  const label = input.scopeType === 'SCHOOL' ? 'school' : 'department';
  throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, `Unknown ${label}`, {
    fields: [{ path: 'body.scopeId', message: `No ${label} exists with this id` }],
  });
}
