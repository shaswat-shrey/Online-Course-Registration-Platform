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
  mfaCodeSchema,
  mfaDisableSchema,
  mfaVerifySchema,
  resetPasswordSchema,
} from '@ucrams/shared';
import { getActor, requestMeta } from '../../common/context/actor.js';
import { AppError } from '../../common/exceptions/app-error.js';
import { defineRoute } from '../../common/http/define-route.js';
import { sendOk } from '../../common/http/response.js';
import * as mfa from './mfa.service.js';
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
  verifyMfaLogin,
} from './auth.service.js';
import { clearAuthCookies, requireCsrf, setAuthCookies } from './auth.cookies.js';
import {
  accessTokenSchema,
  loginAttemptSchema,
  loginResultSchema,
  mfaChallengeSchema,
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
    responses: {
      200: {
        description: 'Signed in, or a two-factor challenge to finish with /auth/mfa/verify',
        schema: successEnvelope(z.union([loginResultSchema, mfaChallengeSchema])),
      },
    },
  },
  async (req, res) => {
    const result = await login(req.valid.body, requestMeta(req));
    if ('mfaRequired' in result)
      return void sendOk(res, result, 'Enter the code from your authenticator app');
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
    path: '/auth/mfa/verify',
    summary: 'Finish signing in with an authenticator or recovery code',
    description: 'Exchanges the challenge from /auth/login (5 minutes, 5 attempts) for a session.',
    tags,
    access: { public: true },
    request: { body: mfaVerifySchema },
    middleware: [tokenLimiter],
    responses: { 200: { description: 'Signed in', schema: successEnvelope(loginResultSchema) } },
  },
  async (req, res) => {
    const result = await verifyMfaLogin(
      req.valid.body.challengeToken,
      req.valid.body.code,
      requestMeta(req),
    );
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
    method: 'get',
    path: '/auth/mfa',
    summary: 'Your two-factor sign-in status',
    tags,
    access: { authenticated: true },
    responses: {
      200: {
        description: 'Status',
        schema: successEnvelope(
          z.object({ enabled: z.boolean(), recoveryCodesRemaining: z.number() }),
        ),
      },
    },
  },
  async (req, res) => {
    sendOk(res, await mfa.status(getActor(req)), 'Two-factor status');
  },
);

defineRoute(
  authRouter,
  {
    method: 'post',
    path: '/auth/mfa/setup',
    summary: 'Start two-factor enrolment (returns the secret and otpauth URL)',
    tags,
    access: { authenticated: true },
    responses: {
      200: {
        description: 'Secret',
        schema: successEnvelope(z.object({ secret: z.string(), otpauthUrl: z.string() })),
      },
    },
  },
  async (req, res) => {
    sendOk(res, await mfa.startSetup(getActor(req)), 'Scan the code with your authenticator app');
  },
);

const recoveryCodes = successEnvelope(z.object({ recoveryCodes: z.array(z.string()) }));

defineRoute(
  authRouter,
  {
    method: 'post',
    path: '/auth/mfa/enable',
    summary: 'Confirm enrolment with the first code; returns one-time recovery codes',
    tags,
    access: { authenticated: true },
    request: { body: mfaCodeSchema },
    middleware: [tokenLimiter],
    responses: { 200: { description: 'Enabled', schema: recoveryCodes } },
  },
  async (req, res) => {
    sendOk(
      res,
      await mfa.confirmSetup(getActor(req), req.valid.body.code),
      'Two-factor sign-in is on',
    );
  },
);

defineRoute(
  authRouter,
  {
    method: 'post',
    path: '/auth/mfa/disable',
    summary: 'Turn two-factor sign-in off (password and a current code)',
    tags,
    access: { authenticated: true },
    request: { body: mfaDisableSchema },
    middleware: [tokenLimiter],
    responses: { 200: { description: 'Disabled' } },
  },
  async (req, res) => {
    await mfa.disable(getActor(req), req.valid.body.password, req.valid.body.code);
    sendOk(res, null, 'Two-factor sign-in is off');
  },
);

defineRoute(
  authRouter,
  {
    method: 'post',
    path: '/auth/mfa/recovery-codes',
    summary: 'Replace your recovery codes (needs a current authenticator code)',
    tags,
    access: { authenticated: true },
    request: { body: mfaCodeSchema },
    middleware: [tokenLimiter],
    responses: { 200: { description: 'New codes', schema: recoveryCodes } },
  },
  async (req, res) => {
    sendOk(
      res,
      await mfa.regenerateRecoveryCodes(getActor(req), req.valid.body.code),
      'New recovery codes',
    );
  },
);

defineRoute(
  authRouter,
  {
    method: 'post',
    path: '/users/:id/mfa/reset',
    summary: "Turn off someone's two-factor sign-in (lost device)",
    tags: ['Account security'],
    access: { permission: 'user:manage_status' },
    request: { params: z.object({ id: z.uuid() }) },
    responses: { 200: { description: 'Reset' } },
  },
  async (req, res) => {
    await mfa.adminReset(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Two-factor sign-in reset');
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
