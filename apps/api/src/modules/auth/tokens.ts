import { createHash, randomBytes } from 'node:crypto';
import { errors, jwtVerify, SignJWT } from 'jose';
import { ErrorCode } from '@ucrams/shared';
import { UnauthenticatedError } from '../../common/exceptions/app-error.js';
import { env } from '../../config/env.js';

const AUDIENCE = 'ucrams-api';
const CLOCK_TOLERANCE_SECONDS = 30;
const encoder = new TextEncoder();
const currentKey = encoder.encode(env.JWT_ACCESS_SECRET);
const previousKey = env.JWT_ACCESS_SECRET_PREVIOUS
  ? encoder.encode(env.JWT_ACCESS_SECRET_PREVIOUS)
  : null;

/** 256-bit random opaque token (base64url). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash('sha256').update(token).digest());
}

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  /** permissionsVersion at issue time */
  pv: number;
}

export async function signAccessToken(
  claims: AccessTokenClaims,
): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + env.JWT_ACCESS_TTL_SECONDS * 1000);
  const token = await new SignJWT({ sid: claims.sid, pv: claims.pv })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(currentKey);
  return { token, expiresAt };
}

async function verifyWith(token: string, key: Uint8Array) {
  return jwtVerify(token, key, {
    issuer: env.JWT_ISSUER,
    audience: AUDIENCE,
    algorithms: ['HS256'],
    clockTolerance: CLOCK_TOLERANCE_SECONDS,
  });
}

/** Verifies an access token; TOKEN_EXPIRED tells clients to refresh, UNAUTHENTICATED to re-login. */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    let result;
    try {
      result = await verifyWith(token, currentKey);
    } catch (err) {
      if (!previousKey || !(err instanceof errors.JWSSignatureVerificationFailed)) throw err;
      result = await verifyWith(token, previousKey);
    }
    const { sub, sid, pv } = result.payload;
    if (typeof sub !== 'string' || typeof sid !== 'string' || typeof pv !== 'number') {
      throw new UnauthenticatedError(ErrorCode.UNAUTHENTICATED, 'Invalid access token');
    }
    return { sub, sid, pv };
  } catch (err) {
    if (err instanceof errors.JWTExpired) {
      throw new UnauthenticatedError(ErrorCode.TOKEN_EXPIRED, 'Access token expired');
    }
    if (err instanceof UnauthenticatedError) throw err;
    throw new UnauthenticatedError(ErrorCode.UNAUTHENTICATED, 'Invalid access token');
  }
}
