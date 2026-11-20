import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AUTH_COOKIE, CSRF_HEADER } from '@ucrams/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { getQueue, QueueName, closeQueues } from '../../infrastructure/queues/queues.js';
import { resetState } from '../../tests/db.js';
import {
  bearer,
  cookieValue,
  createUser,
  login,
  refreshRequest,
  sessionFrom,
  setCookieLine,
  TEST_PASSWORD,
} from '../../tests/factories.js';
import { issueInvitation } from './auth.service.js';

const app = createApp();
const api = '/api/v1';

beforeEach(resetState);
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
});

async function emailJobs(name: string) {
  const jobs = await getQueue(QueueName.EMAIL).getJobs([
    'waiting',
    'delayed',
    'active',
    'completed',
    'failed',
  ]);
  return jobs.filter((j) => j.name === name);
}

function tokenFromEmail(text: string): string {
  const match = text.match(/token=([^\s&]+)/);
  return decodeURIComponent(match![1]!);
}

describe('login', () => {
  it('signs in, sets hardened cookies and returns the profile', async () => {
    const user = await createUser({ roles: ['STUDENT'], email: 'Jane.Doe@Test.edu' });
    const res = await request(app)
      .post(`${api}/auth/login`)
      .send({ email: '  JANE.DOE@test.edu ', password: TEST_PASSWORD })
      .expect(200);

    expect(res.body.data.me.user.id).toBe(user.id);
    expect(res.body.data.me.portals).toEqual(['student']);
    expect(res.body.data.me.permissions).toContain('registration:self');
    expect(res.body.data.accessToken.split('.')).toHaveLength(3);

    const rt = setCookieLine(res, AUTH_COOKIE.refresh)!;
    expect(rt).toMatch(/HttpOnly/);
    expect(rt).toMatch(/SameSite=Strict/);
    expect(rt).toMatch(/Path=\/api\/v1\/auth/);
    const csrf = setCookieLine(res, AUTH_COOKIE.csrf)!;
    expect(csrf).not.toMatch(/HttpOnly/);

    // Only the hash of the refresh token is stored.
    const raw = cookieValue(res, AUTH_COOKIE.refresh)!;
    const stored = await prisma.refreshToken.findMany();
    expect(stored).toHaveLength(1);
    expect(Buffer.from(stored[0]!.tokenHash).toString('utf8')).not.toContain(raw);

    const attempts = await prisma.loginAttempt.findMany({ where: { userId: user.id } });
    expect(attempts.map((a) => a.outcome)).toEqual(['SUCCESS']);
  });

  it('returns the same response for unknown email and wrong password (AC-AUTH-003 style)', async () => {
    await createUser({ email: 'known@test.edu' });
    const wrong = await request(app)
      .post(`${api}/auth/login`)
      .send({ email: 'known@test.edu', password: 'wrong-password' });
    const unknown = await request(app)
      .post(`${api}/auth/login`)
      .send({ email: 'nobody@test.edu', password: 'wrong-password' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const strip = (b: { error: { requestId?: string } }) => ({
      ...b,
      error: { ...b.error, requestId: undefined },
    });
    expect(strip(wrong.body)).toEqual(strip(unknown.body));
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('treats invited accounts without a password like unknown accounts', async () => {
    await createUser({ email: 'invited@test.edu', status: 'INVITED', password: null });
    const res = await request(app)
      .post(`${api}/auth/login`)
      .send({ email: 'invited@test.edu', password: 'anything-at-all' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('reveals inactive status only after a correct password', async () => {
    await createUser({ email: 'suspended@test.edu', status: 'SUSPENDED' });
    const wrong = await request(app)
      .post(`${api}/auth/login`)
      .send({ email: 'suspended@test.edu', password: 'wrong-password' });
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    const right = await request(app)
      .post(`${api}/auth/login`)
      .send({ email: 'suspended@test.edu', password: TEST_PASSWORD });
    expect(right.status).toBe(403);
    expect(right.body.error.code).toBe('ACCOUNT_INACTIVE');
  });

  it('locks the account after 5 failures (AC-AUTH-002) and hides the lock from wrong passwords', async () => {
    const user = await createUser({ email: 'lock@test.edu' });
    for (let i = 0; i < 5; i += 1) {
      const r = await request(app)
        .post(`${api}/auth/login`)
        .send({ email: 'lock@test.edu', password: `wrong-${i}-password` });
      expect(r.body.error.code).toBe('INVALID_CREDENTIALS');
    }
    const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);

    const wrongWhileLocked = await request(app)
      .post(`${api}/auth/login`)
      .send({ email: 'lock@test.edu', password: 'wrong-again-123' });
    expect(wrongWhileLocked.status).toBe(401);
    const rightWhileLocked = await request(app)
      .post(`${api}/auth/login`)
      .send({ email: 'lock@test.edu', password: TEST_PASSWORD });
    expect(rightWhileLocked.status).toBe(423);
    expect(rightWhileLocked.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(Number(rightWhileLocked.headers['retry-after'])).toBeGreaterThan(0);

    expect(
      await prisma.auditLog.count({ where: { action: 'auth.account_locked', entityId: user.id } }),
    ).toBe(1);

    // Lock expiry: success afterwards clears the counters.
    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    await request(app)
      .post(`${api}/auth/login`)
      .send({ email: 'lock@test.edu', password: TEST_PASSWORD })
      .expect(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after).toMatchObject({ failedLoginCount: 0, lockoutCount: 0, lockedUntil: null });
  });

  it('doubles the lock duration on repeated lockouts', async () => {
    const user = await createUser({ email: 'relock@test.edu' });
    await prisma.user.update({
      where: { id: user.id },
      data: { lockoutCount: 2, failedLoginCount: 4 },
    });
    await request(app)
      .post(`${api}/auth/login`)
      .send({ email: 'relock@test.edu', password: 'wrong-password-x' });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(u.lockoutCount).toBe(3);
    // 15 min × 2^(3-1) = 60 min
    expect(u.lockedUntil!.getTime() - Date.now()).toBeGreaterThan(59 * 60_000);
  });

  it('rate limits repeated attempts for one identifier with 429', async () => {
    let last;
    for (let i = 0; i < 11; i += 1) {
      last = await request(app)
        .post(`${api}/auth/login`)
        .send({ email: 'target@test.edu', password: `guess-${i}-xxxx` });
    }
    expect(last!.status).toBe(429);
    expect(last!.body.error.code).toBe('RATE_LIMITED');
  });

  it('rejects malformed input with VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post(`${api}/auth/login`)
      .send({ email: 'not-an-email' })
      .expect(400);
    expect(res.body.error.details.fields.map((f: { path: string }) => f.path)).toEqual(
      expect.arrayContaining(['body.email', 'body.password']),
    );
  });
});

describe('access tokens and /auth/me', () => {
  it('requires a bearer token', async () => {
    const res = await request(app).get(`${api}/auth/me`).expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    await request(app).get(`${api}/auth/me`).set('Authorization', 'Bearer not.a.jwt').expect(401);
  });

  it('forces a refresh when permissions change (FR-AUTH-020)', async () => {
    const user = await createUser({ roles: ['STUDENT'] });
    const s = await login(app, user.email);
    await prisma.user.update({
      where: { id: user.id },
      data: { permissionsVersion: { increment: 1 } },
    });
    const { invalidateAuthState } = await import('../authz/grants.service.js');
    await invalidateAuthState([user.id]);
    const stale = await request(app).get(`${api}/auth/me`).set(bearer(s)).expect(401);
    expect(stale.body.error.code).toBe('TOKEN_EXPIRED');
    const refreshed = await refreshRequest(app, s).expect(200);
    await request(app)
      .get(`${api}/auth/me`)
      .set(bearer(sessionFrom(refreshed, s)))
      .expect(200);
  });
});

describe('refresh rotation', () => {
  it('rotates the refresh token and the CSRF token', async () => {
    const user = await createUser();
    const s = await login(app, user.email);
    const res = await refreshRequest(app, s).expect(200);
    const next = sessionFrom(res, s);
    expect(next.refreshToken).not.toBe(s.refreshToken);
    expect(next.csrf).not.toBe(s.csrf);
    expect(next.accessToken).toBeTruthy();
    await refreshRequest(app, next).expect(200);
  });

  it('requires the CSRF header and an allowed Origin', async () => {
    const user = await createUser();
    const s = await login(app, user.email);
    const noHeader = await request(app)
      .post(`${api}/auth/refresh`)
      .set('Cookie', s.cookie)
      .expect(403);
    expect(noHeader.body.message).toMatch(/CSRF/);
    await request(app)
      .post(`${api}/auth/refresh`)
      .set('Cookie', s.cookie)
      .set(CSRF_HEADER, 'forged')
      .expect(403);
    await refreshRequest(app, s).set('Origin', 'https://evil.example').expect(403);
    await refreshRequest(app, s).set('Origin', 'http://localhost:5173').expect(200);
  });

  it('tolerates a concurrent refresh with the same token inside the grace window', async () => {
    const user = await createUser();
    const s = await login(app, user.email);
    const [a, b] = await Promise.all([refreshRequest(app, s), refreshRequest(app, s)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    // Exactly one rotation happened.
    expect(await prisma.refreshToken.count()).toBe(2);
  });

  it('detects reuse after the grace window and revokes the session (AC-AUTH-001)', async () => {
    const user = await createUser();
    const s = await login(app, user.email);
    const rotated = sessionFrom(await refreshRequest(app, s).expect(200), s);
    // Simulate time passing beyond the grace window.
    await prisma.refreshToken.updateMany({
      where: { usedAt: { not: null } },
      data: { usedAt: new Date(Date.now() - 60_000) },
    });

    const reuse = await refreshRequest(app, s).expect(401);
    expect(reuse.body.error.code).toBe('SESSION_REVOKED');
    expect(setCookieLine(reuse, AUTH_COOKIE.refresh)).toMatch(/Expires=Thu, 01 Jan 1970/);

    const legit = await refreshRequest(app, rotated).expect(401);
    expect(legit.body.error.code).toBe('SESSION_REVOKED');
    // Access tokens of the revoked session stop working immediately.
    const me = await request(app).get(`${api}/auth/me`).set(bearer(rotated)).expect(401);
    expect(me.body.error.code).toBe('SESSION_REVOKED');
    expect(await prisma.auditLog.count({ where: { action: 'auth.refresh_token_reuse' } })).toBe(1);
  });

  it('refuses refresh for suspended accounts', async () => {
    const user = await createUser();
    const s = await login(app, user.email);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
    const res = await refreshRequest(app, s).expect(401);
    expect(res.body.error.code).toBe('SESSION_REVOKED');
  });

  it('rejects a missing or unknown refresh cookie', async () => {
    await request(app)
      .post(`${api}/auth/refresh`)
      .set('Cookie', `${AUTH_COOKIE.csrf}=x`)
      .set(CSRF_HEADER, 'x')
      .expect(401);
    await refreshRequest(app, {
      cookie: `${AUTH_COOKIE.refresh}=bogus; ${AUTH_COOKIE.csrf}=x`,
      csrf: 'x',
    }).expect(401);
  });
});

describe('logout and session management', () => {
  it('logout revokes the session, clears cookies and kills the access token', async () => {
    const user = await createUser();
    const s = await login(app, user.email);
    const res = await request(app)
      .post(`${api}/auth/logout`)
      .set('Cookie', s.cookie)
      .set(CSRF_HEADER, s.csrf)
      .expect(200);
    expect(setCookieLine(res, AUTH_COOKIE.refresh)).toMatch(/Expires=Thu, 01 Jan 1970/);
    await request(app).get(`${api}/auth/me`).set(bearer(s)).expect(401);
    await refreshRequest(app, s).expect(401);
    // Idempotent
    await request(app)
      .post(`${api}/auth/logout`)
      .set('Cookie', s.cookie)
      .set(CSRF_HEADER, s.csrf)
      .expect(200);
  });

  it('lists sessions, revokes another device, and logs out everywhere', async () => {
    const user = await createUser();
    const laptop = await login(app, user.email);
    const phone = await login(app, user.email);

    const list = await request(app).get(`${api}/auth/sessions`).set(bearer(laptop)).expect(200);
    expect(list.body.data).toHaveLength(2);
    expect(
      list.body.data
        .filter((x: { current: boolean }) => x.current)
        .map((x: { id: string }) => x.id),
    ).toEqual([laptop.sessionId]);

    await request(app)
      .delete(`${api}/auth/sessions/${phone.sessionId}`)
      .set(bearer(laptop))
      .expect(200);
    await request(app).get(`${api}/auth/me`).set(bearer(phone)).expect(401);
    await request(app).get(`${api}/auth/me`).set(bearer(laptop)).expect(200);

    // Cannot revoke someone else's session.
    const other = await createUser();
    const otherSession = await login(app, other.email);
    await request(app)
      .delete(`${api}/auth/sessions/${otherSession.sessionId}`)
      .set(bearer(laptop))
      .expect(404);

    const all = await request(app).post(`${api}/auth/logout-all`).set(bearer(laptop)).expect(200);
    expect(all.body.data.sessionsRevoked).toBe(1);
    await request(app).get(`${api}/auth/me`).set(bearer(laptop)).expect(401);
  });

  it('records and returns login history', async () => {
    const user = await createUser();
    await request(app)
      .post(`${api}/auth/login`)
      .send({ email: user.email, password: 'wrong-password-1' });
    const s = await login(app, user.email);
    const res = await request(app).get(`${api}/auth/login-history`).set(bearer(s)).expect(200);
    expect(res.body.data.map((a: { outcome: string }) => a.outcome)).toEqual([
      'SUCCESS',
      'INVALID_CREDENTIALS',
    ]);
  });
});

describe('change password', () => {
  it('requires the current password, enforces policy, and signs out other sessions', async () => {
    const user = await createUser({ email: 'changer@test.edu' });
    const current = await login(app, user.email);
    const other = await login(app, user.email);

    const wrong = await request(app)
      .post(`${api}/auth/change-password`)
      .set(bearer(current))
      .send({ currentPassword: 'not-my-password', newPassword: 'Another-Strong-Pass-1' })
      .expect(422);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');

    const common = await request(app)
      .post(`${api}/auth/change-password`)
      .set(bearer(current))
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'password123' })
      .expect(422);
    expect(common.body.message).toMatch(/too common/);

    const containsEmail = await request(app)
      .post(`${api}/auth/change-password`)
      .set(bearer(current))
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'changer-is-my-name' })
      .expect(422);
    expect(containsEmail.body.message).toMatch(/email/);

    await request(app)
      .post(`${api}/auth/change-password`)
      .set(bearer(current))
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'Another-Strong-Pass-1' })
      .expect(200);
    await request(app).get(`${api}/auth/me`).set(bearer(current)).expect(200);
    await request(app).get(`${api}/auth/me`).set(bearer(other)).expect(401);
    await login(app, user.email, 'Another-Strong-Pass-1');
    expect(await emailJobs('password-changed')).toHaveLength(1);
  });
});

describe('forgot and reset password', () => {
  it('responds identically whether or not the account exists, emailing only real accounts', async () => {
    await createUser({ email: 'real@test.edu' });
    const real = await request(app)
      .post(`${api}/auth/forgot-password`)
      .send({ email: 'real@test.edu' })
      .expect(200);
    const fake = await request(app)
      .post(`${api}/auth/forgot-password`)
      .send({ email: 'fake@test.edu' })
      .expect(200);
    expect(real.body.message).toBe(fake.body.message);
    expect(real.body.data).toEqual(fake.body.data);
    const jobs = await emailJobs('password-reset');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.data.to).toBe('real@test.edu');
  });

  it('resets with a single-use token and revokes every session', async () => {
    const user = await createUser({ email: 'reset@test.edu' });
    const s = await login(app, user.email);
    await request(app)
      .post(`${api}/auth/forgot-password`)
      .send({ email: 'reset@test.edu' })
      .expect(200);
    const token = tokenFromEmail((await emailJobs('password-reset'))[0]!.data.text);

    await request(app)
      .post(`${api}/auth/reset-password`)
      .send({ token, password: 'Brand-New-Secret-77' })
      .expect(200);
    await request(app).get(`${api}/auth/me`).set(bearer(s)).expect(401);
    await login(app, user.email, 'Brand-New-Secret-77');

    const again = await request(app)
      .post(`${api}/auth/reset-password`)
      .send({ token, password: 'Another-New-Secret-8' })
      .expect(422);
    expect(again.body.message).toMatch(/invalid or has expired/);
  });

  it('rejects expired reset tokens and invalidates older ones when a new one is issued', async () => {
    await createUser({ email: 'twice@test.edu' });
    await request(app).post(`${api}/auth/forgot-password`).send({ email: 'twice@test.edu' });
    await request(app).post(`${api}/auth/forgot-password`).send({ email: 'twice@test.edu' });
    const [first, second] = (await emailJobs('password-reset')).sort(
      (a, b) => a.timestamp - b.timestamp,
    );
    const oldToken = tokenFromEmail(first!.data.text);
    const newToken = tokenFromEmail(second!.data.text);
    await request(app)
      .post(`${api}/auth/reset-password`)
      .send({ token: oldToken, password: 'Brand-New-Secret-77' })
      .expect(422);

    await prisma.authToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await request(app)
      .post(`${api}/auth/reset-password`)
      .send({ token: newToken, password: 'Brand-New-Secret-77' })
      .expect(422);
  });
});

describe('invitations', () => {
  it('activates an invited account once', async () => {
    const user = await createUser({
      email: 'newhire@test.edu',
      status: 'INVITED',
      password: null,
      roles: ['FACULTY'],
    });
    const token = await issueInvitation(user.id);
    expect((await emailJobs('invitation'))[0]!.data.to).toBe('newhire@test.edu');

    await request(app)
      .post(`${api}/auth/accept-invite`)
      .send({ token, password: 'Welcome-Aboard-2026' })
      .expect(200);
    const activated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(activated.status).toBe('ACTIVE');
    expect(activated.emailVerifiedAt).not.toBeNull();
    const s = await login(app, 'newhire@test.edu', 'Welcome-Aboard-2026');
    expect(s.accessToken).toBeTruthy();

    await request(app)
      .post(`${api}/auth/accept-invite`)
      .send({ token, password: 'Welcome-Aboard-2027' })
      .expect(422);
  });

  it('cannot re-invite an active account', async () => {
    const user = await createUser();
    await expect(issueInvitation(user.id)).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
  });
});
