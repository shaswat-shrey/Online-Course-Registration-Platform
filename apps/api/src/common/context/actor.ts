import type { Request } from 'express';
import type { PermissionKey } from '@ucrams/shared';
import { UnauthenticatedError } from '../exceptions/app-error.js';

/** A single scope a permission is granted at (USER_ROLES_AND_PERMISSIONS.md §1). */
/**
 * `OWN` comes from relationship roles (faculty, student): it never covers an
 * organisational target and is only usable through relationship policies (ADR-014).
 */
export type Grant =
  | { scope: 'GLOBAL' }
  | { scope: 'SCHOOL'; id: string }
  | { scope: 'DEPARTMENT'; id: string }
  | { scope: 'OWN' };

export type GrantMap = Partial<Record<PermissionKey, Grant[]>>;

/**
 * The authenticated caller, built by the authenticate middleware. Services take
 * this instead of the Express request so authorization and auditing do not
 * depend on HTTP (ARCHITECTURE.md §3.2).
 */
export interface ActorContext {
  userId: string;
  sessionId: string;
  grants: GrantMap;
  ip: string | null;
  userAgent: string | null;
  requestId: string;
}

/** Request metadata for audit/login records when there is no authenticated actor. */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
}

export type AuthenticatedRequest = Request & { actor: ActorContext };

export function requestMeta(req: Request): RequestMeta {
  return {
    ip: req.ip ?? null,
    userAgent: req.header('user-agent')?.slice(0, 500) ?? null,
    requestId: String(req.id),
  };
}

export function getActor(req: Request): ActorContext {
  const actor = (req as Partial<AuthenticatedRequest>).actor;
  if (!actor) throw new UnauthenticatedError();
  return actor;
}
