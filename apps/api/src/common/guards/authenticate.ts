import type { RequestHandler } from 'express';
import { ErrorCode, type PermissionKey } from '@ucrams/shared';
import { getAuthState } from '../../modules/authz/grants.service.js';
import { hasPermission } from '../../modules/authz/authz.js';
import { isSessionRevoked } from '../../modules/auth/session.service.js';
import { verifyAccessToken } from '../../modules/auth/tokens.js';
import { requestMeta, type ActorContext, type AuthenticatedRequest } from '../context/actor.js';
import { ForbiddenError, UnauthenticatedError } from '../exceptions/app-error.js';

const sessionEnded = () =>
  new UnauthenticatedError(
    ErrorCode.SESSION_REVOKED,
    'Your session has ended. Please sign in again.',
  );

/** Resolves a bearer token to an actor, or throws an authentication error. */
export async function resolveActor(
  token: string,
  meta: ReturnType<typeof requestMeta>,
): Promise<ActorContext> {
  const claims = await verifyAccessToken(token);
  if (await isSessionRevoked(claims.sid)) throw sessionEnded();
  const state = await getAuthState(claims.sub);
  if (!state || state.status !== 'ACTIVE') throw sessionEnded();
  // Roles changed since the token was issued: force a refresh to pick them up (FR-AUTH-020).
  if (claims.pv !== state.permissionsVersion) {
    throw new UnauthenticatedError(
      ErrorCode.TOKEN_EXPIRED,
      'Permissions changed; refresh required',
    );
  }
  return { userId: claims.sub, sessionId: claims.sid, grants: state.grants, ...meta };
}

export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.header('authorization');
  const match = header?.match(/^Bearer\s+([A-Za-z0-9._-]+)$/);
  if (!match) return next(new UnauthenticatedError());
  try {
    (req as AuthenticatedRequest).actor = await resolveActor(match[1]!, requestMeta(req));
    next();
  } catch (err) {
    next(err);
  }
};

/** Coarse check: the permission is held at some scope. Services do the scope check. */
export function requirePermission(permission: PermissionKey): RequestHandler {
  return (req, _res, next) => {
    const actor = (req as Partial<AuthenticatedRequest>).actor;
    if (!actor) return next(new UnauthenticatedError());
    if (!hasPermission(actor.grants, permission)) return next(new ForbiddenError());
    next();
  };
}
