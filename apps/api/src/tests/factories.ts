import type { Express } from 'express';
import request, { type Response } from 'supertest';
import { AUTH_COOKIE, CSRF_HEADER, type RoleKey } from '@ucrams/shared';
import { prisma } from '../infrastructure/database/prisma.js';
import { hashPassword } from '../modules/auth/password.js';

export const TEST_PASSWORD = 'Correct-Horse-Battery-9';
let counter = 0;
let cachedHash: string | undefined;

export async function createUser(
  options: {
    roles?: RoleKey[];
    status?: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
    email?: string;
    password?: string | null;
  } = {},
) {
  counter += 1;
  const password = options.password === undefined ? TEST_PASSWORD : options.password;
  cachedHash ??= await hashPassword(TEST_PASSWORD);
  const passwordHash =
    password === null
      ? null
      : password === TEST_PASSWORD
        ? cachedHash
        : await hashPassword(password);
  const roles = await prisma.role.findMany({ where: { key: { in: options.roles ?? [] } } });
  return prisma.user.create({
    data: {
      email: options.email ?? `user${counter}-${Date.now()}@test.edu`,
      firstName: 'Test',
      lastName: `User${counter}`,
      passwordHash,
      status: options.status ?? 'ACTIVE',
      roles: { create: roles.map((r) => ({ roleId: r.id, scopeType: 'GLOBAL' as const })) },
    },
  });
}

/** Extracts a cookie value from a response's Set-Cookie headers. */
export function cookieValue(res: Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const line = raw?.find((c) => c.startsWith(`${name}=`));
  if (!line) return undefined;
  return decodeURIComponent(line.split(';')[0]!.slice(name.length + 1));
}

export function setCookieLine(res: Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith(`${name}=`));
}

export interface TestSession {
  accessToken: string;
  refreshToken: string;
  csrf: string;
  sessionId: string;
  /** Cookie header for cookie-authenticated endpoints. */
  cookie: string;
}

export function sessionFrom(res: Response, previous?: TestSession): TestSession {
  const refreshToken = cookieValue(res, AUTH_COOKIE.refresh) ?? previous!.refreshToken;
  const csrf = cookieValue(res, AUTH_COOKIE.csrf) ?? previous!.csrf;
  return {
    accessToken: res.body.data.accessToken,
    refreshToken,
    csrf,
    sessionId: res.body.data.me?.sessionId ?? previous?.sessionId,
    cookie: `${AUTH_COOKIE.refresh}=${refreshToken}; ${AUTH_COOKIE.csrf}=${csrf}`,
  };
}

export async function login(
  app: Express,
  email: string,
  password = TEST_PASSWORD,
): Promise<TestSession> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
  return sessionFrom(res);
}

export function refreshRequest(app: Express, s: Pick<TestSession, 'cookie' | 'csrf'>) {
  return request(app).post('/api/v1/auth/refresh').set('Cookie', s.cookie).set(CSRF_HEADER, s.csrf);
}

export const bearer = (s: { accessToken: string }) => ({
  Authorization: `Bearer ${s.accessToken}`,
});
