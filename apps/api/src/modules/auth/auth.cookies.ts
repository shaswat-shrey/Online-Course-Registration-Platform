import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, RequestHandler, Response } from 'express';
import { AUTH_COOKIE, CSRF_HEADER, ErrorCode } from '@ucrams/shared';
import { AppError } from '../../common/exceptions/app-error.js';
import { cookieSecure, env } from '../../config/env.js';

export const REFRESH_COOKIE_PATH = '/api/v1/auth';

function base(maxAgeMs: number): CookieOptions {
  return { secure: cookieSecure(env), sameSite: 'strict', maxAge: maxAgeMs };
}

/**
 * Refresh token: HttpOnly, path-scoped to the auth endpoints. CSRF token: readable
 * by the SPA (double-submit, SECURITY.md §3).
 */
export function setAuthCookies(res: Response, refreshToken: string, expiresAt: Date): void {
  const maxAge = Math.max(0, expiresAt.getTime() - Date.now());
  res.cookie(AUTH_COOKIE.refresh, refreshToken, {
    ...base(maxAge),
    httpOnly: true,
    path: REFRESH_COOKIE_PATH,
  });
  res.cookie(AUTH_COOKIE.csrf, randomBytes(24).toString('base64url'), {
    ...base(maxAge),
    httpOnly: false,
    path: '/',
  });
}

export function clearAuthCookies(res: Response): void {
  const opts = { secure: cookieSecure(env), sameSite: 'strict' as const };
  res.clearCookie(AUTH_COOKIE.refresh, { ...opts, httpOnly: true, path: REFRESH_COOKIE_PATH });
  res.clearCookie(AUTH_COOKIE.csrf, { ...opts, path: '/' });
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Protects cookie-authenticated endpoints: the Origin (when sent) must be allowed,
 * and the X-CSRF-Token header must equal the csrf cookie.
 */
export const requireCsrf: RequestHandler = (req, _res, next) => {
  const origin = req.header('origin');
  if (origin && !env.CORS_ORIGINS.includes(origin)) {
    return next(new AppError(403, ErrorCode.FORBIDDEN, 'Origin not allowed'));
  }
  const cookie = req.cookies?.[AUTH_COOKIE.csrf] as string | undefined;
  const header = req.header(CSRF_HEADER);
  if (!cookie || !header || !safeEqual(cookie, header)) {
    return next(new AppError(403, ErrorCode.FORBIDDEN, 'Missing or invalid CSRF token'));
  }
  next();
};
