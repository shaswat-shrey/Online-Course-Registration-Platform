import { useEffect, type ReactNode } from 'react';
import { authApi } from '@/features/auth/api/auth-api';
import { csrfToken } from '@/services/cookies';
import { refreshOnce } from '@/services/http';
import { useAuthStore } from '@/store/auth-store';

/**
 * Restores the session on page load: the access token lives in memory only, so
 * a reload exchanges the HttpOnly refresh cookie for a new one. Skipped when no
 * CSRF cookie exists (never signed in, or signed out).
 */
export async function restoreSession(): Promise<void> {
  const store = useAuthStore.getState();
  // Only on first load: never overwrite a session that is already established.
  if (store.status !== 'loading') return;
  if (!csrfToken()) {
    store.clear();
    return;
  }
  try {
    const token = await refreshOnce();
    const me = await authApi.me();
    useAuthStore.getState().setSession(token, me);
  } catch {
    useAuthStore.getState().clear();
  }
}

let started: Promise<void> | null = null;

export function AuthBootstrap({ children }: { children: ReactNode }) {
  useEffect(() => {
    started ??= restoreSession().finally(() => {
      started = null;
    });
  }, []);
  return children;
}
