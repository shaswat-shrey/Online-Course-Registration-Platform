import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useAuthStore } from '@/store/auth-store';
import { authApi } from './api/auth-api';

/** Revokes the server session (best effort), then clears all client state. */
export function useSignOut() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      useAuthStore.getState().clear('signed-out');
      queryClient.clear();
      navigate('/login', { replace: true });
    }
  }, [navigate, queryClient]);
}
