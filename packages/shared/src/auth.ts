import { z } from 'zod';
import type { PermissionKey } from './permissions.js';
import type { Portal, ScopeType } from './roles.js';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Structural password rules shared with the client; the server also checks a common-password list. */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`);

export const loginSchema = z.object({
  email,
  // Login never validates password strength (old passwords may predate the policy).
  password: z.string().min(1, 'Password is required').max(PASSWORD_MAX_LENGTH),
  rememberMe: z.boolean().optional().default(false),
});
export type LoginInput = z.input<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

const token = z.string().min(20).max(200);

export const resetPasswordSchema = z.object({ token, password: passwordSchema });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const acceptInviteSchema = z.object({ token, password: passwordSchema });
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'New password must differ from the current password',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export interface RoleAssignmentDto {
  id: string;
  roleKey: string;
  roleName: string;
  scopeType: ScopeType;
  scopeId: string | null;
  /** RELATIONSHIP roles apply only to the holder's own sections/records. */
  scopeMode: 'ORGANIZATIONAL' | 'RELATIONSHIP';
}

export interface MeDto {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    status: string;
    lastLoginAt: string | null;
    avatarUrl: string | null;
  };
  roles: RoleAssignmentDto[];
  /** Union of permissions across all assignments (scope details stay server-side). */
  permissions: PermissionKey[];
  /**
   * Scope of each permission, so the UI can hide actions no scope permits
   * (e.g. creating departments needs a school-wide or university-wide grant).
   */
  grants: Partial<
    Record<PermissionKey, Array<{ scope: 'GLOBAL' | 'SCHOOL' | 'DEPARTMENT' | 'OWN'; id?: string }>>
  >;
  portals: Portal[];
  sessionId: string;
}

export interface LoginResultDto {
  accessToken: string;
  accessTokenExpiresAt: string;
  me: MeDto;
}

export interface RefreshResultDto {
  accessToken: string;
  accessTokenExpiresAt: string;
}

export interface SessionDto {
  id: string;
  deviceLabel: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export interface LoginAttemptDto {
  id: string;
  outcome: string;
  ip: string | null;
  deviceLabel: string | null;
  createdAt: string;
}

/** Cookie and header names shared by API and client. */
export const AUTH_COOKIE = { refresh: 'ucrams_rt', csrf: 'ucrams_csrf' } as const;
export const CSRF_HEADER = 'x-csrf-token';
