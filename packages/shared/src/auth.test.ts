import { describe, expect, it } from 'vitest';
import { changePasswordSchema, loginSchema, resetPasswordSchema } from './auth.js';

describe('auth schemas', () => {
  it('normalizes email case and whitespace', () => {
    expect(loginSchema.parse({ email: '  Jane.Doe@Example.EDU ', password: 'x' }).email).toBe(
      'jane.doe@example.edu',
    );
  });

  it('defaults rememberMe to false', () => {
    expect(loginSchema.parse({ email: 'a@b.edu', password: 'x' }).rememberMe).toBe(false);
  });

  it('enforces password length on reset', () => {
    expect(
      resetPasswordSchema.safeParse({ token: 't'.repeat(43), password: 'short' }).success,
    ).toBe(false);
    expect(
      resetPasswordSchema.safeParse({ token: 't'.repeat(43), password: 'long-enough-pass' })
        .success,
    ).toBe(true);
  });

  it('requires the new password to differ', () => {
    const r = changePasswordSchema.safeParse({
      currentPassword: 'same-password-1',
      newPassword: 'same-password-1',
    });
    expect(r.success).toBe(false);
  });
});
