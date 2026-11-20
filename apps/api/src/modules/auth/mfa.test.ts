import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { closeQueues } from '../../infrastructure/queues/queues.js';
import { resetState } from '../../tests/db.js';
import { bearer, createUser, login, TEST_PASSWORD } from '../../tests/factories.js';
import {
  base32Decode,
  base32Encode,
  currentStep,
  decryptSecret,
  encryptSecret,
  totpAt,
  verifyTotp,
} from './totp.js';

const app = createApp();
const api = '/api/v1';

beforeEach(resetState);
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
});

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 appendix B, SHA-1 seed "12345678901234567890", truncated to 6 digits.
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('at %i seconds the code is %s', (t, code) => {
    expect(totpAt(secret, Math.floor(t / 30))).toBe(code);
  });

  it('round-trips base32, tolerates one step of drift and refuses replays', () => {
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    const now = 1_700_000_000_000;
    const step = currentStep(now);
    expect(verifyTotp(secret, totpAt(secret, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step - 2), null, now)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, step), step, now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', null, now)).toBeNull();
  });

  it('encrypts secrets with authenticated encryption', () => {
    const stored = encryptSecret(secret);
    expect(stored).not.toContain(secret);
    expect(decryptSecret(stored)).toBe(secret);
    const tampered = stored.slice(0, -2) + (stored.endsWith('A') ? 'BB' : 'AA');
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe('two-factor sign-in', () => {
  it('enrols, challenges at sign-in, accepts recovery codes and resists replay', async () => {
    const user = await createUser({ roles: ['STUDENT'] });
    const session = await login(app, user.email);

    const setup = await request(app).post(`${api}/auth/mfa/setup`).set(bearer(session)).expect(200);
    const secret: string = setup.body.data.secret;
    expect(setup.body.data.otpauthUrl).toMatch(/^otpauth:\/\/totp\/.+secret=/);
    await request(app)
      .post(`${api}/auth/mfa/enable`)
      .set(bearer(session))
      .send({ code: '000000' })
      .expect(401);
    const enabled = await request(app)
      .post(`${api}/auth/mfa/enable`)
      .set(bearer(session))
      .send({ code: totpAt(secret, currentStep()) })
      .expect(200);
    const codes: string[] = enabled.body.data.recoveryCodes;
    expect(codes).toHaveLength(10);
    const me = await request(app).get(`${api}/auth/me`).set(bearer(session)).expect(200);
    expect(me.body.data.user.mfaEnabled).toBe(true);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.mfaSecretEnc).not.toContain(secret);

    // Password alone now yields a challenge, not a session.
    const step1 = await request(app)
      .post(`${api}/auth/login`)
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);
    expect(step1.body.data).toMatchObject({ mfaRequired: true });
    expect(step1.body.data.accessToken).toBeUndefined();
    expect(step1.headers['set-cookie']).toBeUndefined();
    const challenge = step1.body.data.challengeToken;

    // The code used to enable is already spent (replay); a wrong code is refused.
    const spent = await request(app)
      .post(`${api}/auth/mfa/verify`)
      .send({ challengeToken: challenge, code: totpAt(secret, currentStep()) })
      .expect(401);
    expect(spent.body.error.code).toBe('MFA_INVALID');
    const ok = await request(app)
      .post(`${api}/auth/mfa/verify`)
      .send({ challengeToken: challenge, code: codes[0] })
      .expect(200);
    expect(ok.body.data.accessToken).toBeTruthy();
    expect(ok.headers['set-cookie']).toBeDefined();
    // The challenge and the recovery code are single use.
    await request(app)
      .post(`${api}/auth/mfa/verify`)
      .send({ challengeToken: challenge, code: codes[1] })
      .expect(401);
    const again = await request(app)
      .post(`${api}/auth/login`)
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);
    await request(app)
      .post(`${api}/auth/mfa/verify`)
      .send({ challengeToken: again.body.data.challengeToken, code: codes[0] })
      .expect(401);
    const status = await request(app).get(`${api}/auth/mfa`).set(bearer(session)).expect(200);
    expect(status.body.data).toEqual({ enabled: true, recoveryCodesRemaining: 9 });
    expect(
      // The reused challenge is rejected as expired before any code is checked.
      await prisma.loginAttempt.count({ where: { userId: user.id, outcome: 'MFA_FAILED' } }),
    ).toBe(2);

    // Turning it off needs the password and a code.
    await request(app)
      .post(`${api}/auth/mfa/disable`)
      .set(bearer(session))
      .send({ password: 'wrong-password-1', code: codes[2] })
      .expect(401);
    await request(app)
      .post(`${api}/auth/mfa/disable`)
      .set(bearer(session))
      .send({ password: TEST_PASSWORD, code: codes[2] })
      .expect(200);
    const plain = await request(app)
      .post(`${api}/auth/login`)
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);
    expect(plain.body.data.accessToken).toBeTruthy();
  });

  it('locks a challenge after five wrong codes and lets administrators reset two-factor', async () => {
    const user = await createUser({ roles: ['STUDENT'] });
    const session = await login(app, user.email);
    const { secret } = (await request(app).post(`${api}/auth/mfa/setup`).set(bearer(session))).body
      .data;
    await request(app)
      .post(`${api}/auth/mfa/enable`)
      .set(bearer(session))
      .send({ code: totpAt(secret, currentStep()) })
      .expect(200);
    const step1 = await request(app)
      .post(`${api}/auth/login`)
      .send({ email: user.email, password: TEST_PASSWORD });
    for (let i = 0; i < 5; i++)
      await request(app)
        .post(`${api}/auth/mfa/verify`)
        .send({ challengeToken: step1.body.data.challengeToken, code: '000000' })
        .expect(401);
    const expired = await request(app)
      .post(`${api}/auth/mfa/verify`)
      .send({
        challengeToken: step1.body.data.challengeToken,
        code: totpAt(secret, currentStep() + 1),
      })
      .expect(401);
    expect(expired.body.error.code).toBe('MFA_CHALLENGE_EXPIRED');

    const student = await login(app, (await createUser({ roles: ['STUDENT'] })).email);
    await request(app).post(`${api}/users/${user.id}/mfa/reset`).set(bearer(student)).expect(403);
    const admin = await login(app, (await createUser({ roles: ['SUPER_ADMIN'] })).email);
    await request(app).post(`${api}/users/${user.id}/mfa/reset`).set(bearer(admin)).expect(200);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      mfaEnabled: false,
      mfaSecretEnc: null,
    });
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'auth.mfa_reset' } })).toBe(1);
  });
});
