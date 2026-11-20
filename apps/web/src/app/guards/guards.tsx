import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import type { PermissionKey, Portal } from '@ucrams/shared';
import { FullPageSpinner } from '@/components/shared/full-page-spinner';
import { homePath, useAuthStore } from '@/store/auth-store';
import { safeNext } from '@/utils/safe-next';

/** Requires a session; otherwise sends the user to /login?next=<current path>. */
export function RequireAuth() {
  const status = useAuthStore((s) => s.status);
  const endReason = useAuthStore((s) => s.endReason);
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'anonymous') {
    if (endReason === 'signed-out') return <Navigate to="/login" replace />;
    const params = new URLSearchParams({ next: location.pathname + location.search });
    if (endReason === 'expired') params.set('reason', 'session-ended');
    return <Navigate to={`/login?${params}`} replace />;
  }
  return <Outlet />;
}

/** Requires access to a portal; users without it go to their own home. */
export function RequirePortal({ portal }: { portal: Portal }) {
  const me = useAuthStore((s) => s.me);
  if (!me?.portals.includes(portal))
    return <Navigate to={me?.portals.length ? homePath(me) : '/no-access'} replace />;
  return <Outlet />;
}

/** Page-level permission gate (the server enforces independently). */
export function RequirePermission({ permission }: { permission: PermissionKey }) {
  const allowed = useAuthStore((s) => s.me?.permissions.includes(permission) ?? false);
  if (!allowed) return <Navigate to="/403" replace />;
  return <Outlet />;
}

/** Pages for signed-out users (login etc.) send signed-in users to `next` or home. */
export function PublicOnly() {
  const status = useAuthStore((s) => s.status);
  const me = useAuthStore((s) => s.me);
  const [params] = useSearchParams();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authenticated')
    return <Navigate to={safeNext(params.get('next')) ?? homePath(me)} replace />;
  return <Outlet />;
}

export function HomeRedirect() {
  const status = useAuthStore((s) => s.status);
  const me = useAuthStore((s) => s.me);
  if (status === 'loading') return <FullPageSpinner />;
  return <Navigate to={status === 'authenticated' ? homePath(me) : '/login'} replace />;
}
