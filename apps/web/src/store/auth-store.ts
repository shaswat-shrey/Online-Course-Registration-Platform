import { create } from 'zustand';
import type { MeDto, PermissionKey, Portal } from '@ucrams/shared';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';
/** Why the user is anonymous: drives the login redirect and message. */
export type EndReason = 'signed-out' | 'expired' | null;

interface AuthState {
  status: AuthStatus;
  /** Held in memory only, never persisted (ARCHITECTURE.md §4). */
  accessToken: string | null;
  me: MeDto | null;
  endReason: EndReason;
  setSession: (accessToken: string, me: MeDto) => void;
  setAccessToken: (accessToken: string) => void;
  setMe: (me: MeDto) => void;
  clear: (reason?: EndReason) => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  status: 'loading',
  accessToken: null,
  me: null,
  endReason: null,
  setSession: (accessToken, me) =>
    set({ status: 'authenticated', accessToken, me, endReason: null }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setMe: (me) => set({ me }),
  clear: (reason = null) =>
    set((s) => ({
      status: 'anonymous',
      accessToken: null,
      me: null,
      // A session that ends while signed in has expired unless the user signed out.
      endReason: reason ?? (s.status === 'authenticated' ? 'expired' : null),
    })),
}));

export const PORTAL_HOME: Record<Portal, string> = {
  admin: '/admin/dashboard',
  faculty: '/faculty/dashboard',
  student: '/student/dashboard',
};

export function homePath(me: MeDto | null): string {
  const first = me?.portals[0];
  return first ? PORTAL_HOME[first] : '/no-access';
}

export function useCan(permission: PermissionKey): boolean {
  return useAuthStore((s) => s.me?.permissions.includes(permission) ?? false);
}

type GrantTarget = { schoolId?: string | null; departmentId?: string | null };

/** Mirrors the server's scope rules for UI hints (the API still enforces). */
export function grantCovers(
  permission: PermissionKey,
  target: GrantTarget | 'global' | 'school-or-global',
) {
  const grants = useAuthStore.getState().me?.grants[permission] ?? [];
  return grants.some((g) => {
    if (g.scope === 'GLOBAL') return true;
    if (target === 'global') return false;
    if (target === 'school-or-global') return g.scope === 'SCHOOL';
    if (g.scope === 'SCHOOL') return !!target.schoolId && g.id === target.schoolId;
    if (g.scope === 'DEPARTMENT') return !!target.departmentId && g.id === target.departmentId;
    return false;
  });
}

/** Re-renders when grants change. */
export function useCanAt(
  permission: PermissionKey,
  target: GrantTarget | 'global' | 'school-or-global',
): boolean {
  useAuthStore((s) => s.me?.grants);
  return grantCovers(permission, target);
}
