import {
  CSRF_HEADER,
  type AcceptInviteInput,
  type ChangePasswordInput,
  type LoginAttemptDto,
  type LoginInput,
  type LoginResultDto,
  type MeDto,
  type ResetPasswordInput,
  type SessionDto,
} from '@ucrams/shared';
import { csrfToken } from '@/services/cookies';
import { apiDelete, apiGet, apiPost, http } from '@/services/http';

export const authApi = {
  login: (input: LoginInput) => apiPost<LoginResultDto>('/auth/login', input),
  me: () => apiGet<MeDto>('/auth/me'),
  logout: () =>
    http.post('/auth/logout', undefined, { headers: { [CSRF_HEADER]: csrfToken() ?? '' } }),
  logoutAll: () => apiPost<{ sessionsRevoked: number }>('/auth/logout-all'),
  forgotPassword: (email: string) =>
    http.post<{ message: string }>('/auth/forgot-password', { email }),
  resetPassword: (input: ResetPasswordInput) => apiPost<null>('/auth/reset-password', input),
  acceptInvite: (input: AcceptInviteInput) => apiPost<null>('/auth/accept-invite', input),
  changePassword: (input: ChangePasswordInput) => apiPost<null>('/auth/change-password', input),
  sessions: () => apiGet<SessionDto[]>('/auth/sessions'),
  revokeSession: (id: string) => apiDelete(`/auth/sessions/${id}`),
  loginHistory: () => apiGet<LoginAttemptDto[]>('/auth/login-history'),
};
