import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/features/auth/api/auth-api';

export const accountKeys = {
  sessions: ['account', 'sessions'] as const,
  loginHistory: ['account', 'login-history'] as const,
};

export const useSessions = () =>
  useQuery({ queryKey: accountKeys.sessions, queryFn: authApi.sessions });
export const useLoginHistory = () =>
  useQuery({ queryKey: accountKeys.loginHistory, queryFn: authApi.loginHistory });

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authApi.revokeSession,
    onSuccess: () => qc.invalidateQueries({ queryKey: accountKeys.sessions }),
  });
}
