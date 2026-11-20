import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  acceptInviteSchema,
  AUTH_COOKIE,
  changePasswordSchema,
  ErrorCode,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
} from '@ucrams/shared';
import { getActor, requestMeta } from '../../common/context/actor.js';
import { AppError } from '../../common/exceptions/app-error.js';
import { defineRoute } from '../../common/http/define-route.js';
import { sendOk } from '../../common/http/response.js';
import { strictRateLimit } from '../../common/middleware/rate-limit.js';
import { successEnvelope } from '../../openapi/registry.js';
import {
  acceptInvitation,
  changePassword,
  forgotPassword,
  getMe,
  login,
  loginHistory,
  logout,
  logoutAll,
  listSessions,
  refresh,
  resetPassword,
  revokeOwnSession,
} from './auth.service.js';
import { clearAuthCookies, requireCsrf, setAuthCookies } from './auth.cookies.js';
import {
  accessTokenSchema,
  loginAttemptSchema,
  loginResultSchema,
  meSchema,
  sessionSchema,
} from './auth.schemas.js';

export const authRouter = Router();
const tags = ['Authentication'];
const ip = (req: Request) => req.ip ?? 'unknown';
/** Identifiers are hashed so no email address appears in Redis keys (NFR-PRIV-002). */
const identifier = (req: Request) =>
  createHash('sha256')
    .update(String((req.body as { email?: unknown })?.email ?? '').toLowerCase())
    .digest('base64url')
    .slice(0, 22);
const FIFTEEN_MIN = 15 * 60;

const loginLimiter = strictRateLimit([
  {
    name: 'login-ip-id',
    points: 10,
    durationSeconds: FIFTEEN_MIN,
    key: (r) => `${ip(r)}:${identifier(r)}`,
  },
  { name: 'login-ip', points: 50, durationSeconds: FIFTEEN_MIN, key: ip },
]);
const forgotLimiter = strictRateLimit([
  { name: 'forgot-id', points: 5, durationSeconds: 3600, key: identifier },
  { name: 'forgot-ip', points: 20, durationSeconds: 3600, key: ip },
]);
const tokenLimiter = strictRateLimit([
  { name: 'auth-token', points: 10, durationSeconds: FIFTEEN_MIN, key: ip },
]);
const refreshLimiter = strictRateLimit([
  { name: 'refresh', points: 60, durationSeconds: FIFTEEN_MIN, key: ip },
]);

const refreshCookie = (req: Request) => req.cookies?.[AUTH_COOKIE.refresh] as string | undefined;

defineRoute(
  authRouter,
  {
    method: 'post',
    path: '/auth/login',
    summary: 'Sign in with email and password',
    description:
      'Creates a session. Returns a short-lived access token; the refresh token is set as an HttpOnly cookie.',
    tags,
    access: { public: true },
    request: { body: loginSchema },
    middleware: [loginLimiter],
    responses: { 200: { description: 'Signed in', schema: successEnvelope(loginResultSchema) } },
  },
  async (req, res) => {
    const result = await login(req.valid.body, requestMeta(req));
    setAuthCookies(res, result.refreshToken, result.refreshExpiresAt);
    sendOk(
      res,
      {
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
        me: result.me,
      },
      'Signed in successfully',
    );
  },
);

defineRoute(
  authRouter,
  {
    method: 'post',
    path: '/auth/refresh',
    summary: 'Rotate the refresh token and issue a new access token',
    description:
      'Cookie-authenticated. Requires the X-CSRF-Token header matching the ucrams_csrf cookie.',
    tags,
    access: { public: true },
    middleware: [refreshLimiter, requireCsrf],
    responses: { 200: { description: 'Refreshed', schema: successEnvelope(accessTokenSchema) } },
  },
  async (req, res: Response) => {
    try {
      const result = await refresh(refreshCookie(req), requestMeta(req));
      if (result.refreshToken && result.refreshExpiresAt) {
        setAuthCookies(res, result.refreshToken, result.refreshExpiresAt);
      }
      sendOk(
        res,
        {
          accessToken: result.accessToken,
          accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
        },
        'Session refreshed',
      );
    } catch (err) {
      if (err instanceof AppError && err.code === ErrorCode.SESSION_REVOKED) clearAuthCookies(res);
      throw err;
    }
  },
);

defineRoute(
  authRouter,
  {
    method: 'post',
    path: '/auth/logout',
    summary: 'Sign out of the current session',
    tags,
    access: { public: true },
    middleware: [requireCsrf],
    responses: { 200: { description: 'Signed out' } },
  },
  async (req, res) => {
    await logout(refreshCookie(req), requestMeta(req));
    clearAuthCookies(res);
    sendOk(res, null, 'Signed out');
  },
);

defineRoute(
  authRouter,
  {
    method: 'post',
    path: '/auth/logout-all',
    summary: 'Sign out of every session, including this one',
    tags,
    access: { authenticated: true },
    responses: {
      200: {
        description: 'All sessions revoked',
        schema: successEnvelope(z.object({ sessionsRevoked: z.number() })),
      },
    },
  },
  async (req, res) => {
    const sessionsRevoked = await logoutAll(getActor(req));
    clearAuthCookies(res);
    sendOk(res, { sessionsRevoked }, 'Signed out of all sessions');
  },
);

defineRoute(
  authRouter,
  {
    method: 'get',
    path: '/auth/me',
    summary: 'Current user, role assignments, permissions and portals',
    tags,
    access: { authenticated: true },
    responses: { 200: { description: 'Current user', schema: successEnvelope(meSchema) } },
  },
  async (req, res) => {
    const actor = getActor(req);
    sendOk(res, await getMe(actor.userId, actor.sessionId), 'Profile retrieved');
  },
);

defineRoute(
  authRouter,
  {
    method: 'get',
    path: '/auth/sessions',
    summary: 'List your active sessions',
    tags,
    access: { authenticated: true },
    responses: {
      200: { description: 'Sessions', schema: successEnvelope(z.array(sessionSchema)) },
    },
  },
  async (req, res) => {
    sendOk(res, await listSessions(getActor(req)), 'Sessions retrieved');
  },
);

defineRoute(
  authRouter,
  {
    method: 'delete',
    path: '/auth/sessions/:id',
    summary: 'Revoke one of your sessions',
    tags,
    access: { authenticated: true },
    request: { params: z.object({ id: z.uuid() }) },
    responses: { 200: { description: 'Session revoked' } },
  },
  async (req, res) => {
    const actor = getActor(req);
    await revokeOwnSession(actor, req.valid.params.id);
    if (req.valid.params.id === actor.sessionId) clearAuthCookies(res);
    sendOk(res, null, 'Session revoked');
  },
);

defineRoute(
  authRouter,
  {
    method: 'get',
    path: '/auth/login-history',
    summary: 'Your recent sign-in attempts',
    tags,
    access: { authenticated: true },
    responses: {
      200: { description: 'Login history', schema: successEnvelope(z.array(loginAttemptSchema)) },
    },
  },
  async (req, res) => {
    sendOk(res, await loginHistory(getActor(req).userId), 'Login history retrieved');
  },
);

const FORGOT_MESSAGE = 'If an account exists for that email, a password reset link has been sent.';

defineRoute(
  authRouter,
  {
    method: 'post',
    path: '/auth/forgot-password',
    summary: 'Request a password reset email',
    description: 'Always returns the same response, whether or not the account exists.',
    tags,
    access: { public: true },
    request: { body: forgotPasswordSchema },
    middleware: [forgotLimiter],
    responses: { 200: { description: 'Accepted' } },
  },
  async (req, res) => {
    await forgotPassword(req.valid.body.email, requestMeta(req));
    sendOk(res, null, FORGOT_MESSAGE);
  },
);

defineRoute(
  authRouter,
  {
    method: 'post',
    path: '/auth/reset-password',
    summary: 'Set a new password with a reset token',
    description: 'Signs out every session of the account.',
    tags,
    access: { public: true },
    request: { body: resetPasswordSchema },
    middleware: [tokenLimiter],
    responses: { 200: { description: 'Password reset' } },
  },
  async (req, res) => {
    await resetPassword(req.valid.body, requestMeta(req));
    sendOk(res, null, 'Your password has been reset. You can now sign in.');
  },
);

defineRoute(
  authRouter,
  {
    method: 'post',
    path: '/auth/accept-invite',
    summary: 'Activate an invited account by setting its password',
    tags,
    access: { public: true },
    request: { body: acceptInviteSchema },
    middleware: [tokenLimiter],
    responses: { 200: { description: 'Account activated' } },
  },
  async (req, res) => {
    await acceptInvitation(req.valid.body, requestMeta(req));
    sendOk(res, null, 'Your account is active. You can now sign in.');
  },
);

defineRoute(
  authRouter,
  {
    method: 'post',
    path: '/auth/change-password',
    summary: 'Change your password',
    description: 'Requires the current password. Signs out your other sessions.',
    tags,
    access: { authenticated: true },
    request: { body: changePasswordSchema },
    responses: { 200: { description: 'Password changed' } },
  },
  async (req, res) => {
    await changePassword(getActor(req), req.valid.body);
    sendOk(res, null, 'Password changed. Your other sessions were signed out.');
  },
);
