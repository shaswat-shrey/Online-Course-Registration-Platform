import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { MeDto, PermissionKey, Portal } from '@ucrams/shared';
import { AppProviders } from '@/app/providers/app-providers';
import { routes } from '@/app/router/routes';
import { useAuthStore } from '@/store/auth-store';

export function makeMe(
  options: { portals?: Portal[]; permissions?: PermissionKey[]; roleName?: string } = {},
): MeDto {
  return {
    user: {
      id: '0196f000-0000-7000-8000-0000000000aa',
      email: 'pat@test.edu',
      firstName: 'Pat',
      lastName: 'Tester',
      status: 'ACTIVE',
      lastLoginAt: null,
      avatarUrl: null,
    },
    roles: [
      {
        id: '0196f000-0000-7000-8000-0000000000bb',
        roleKey: 'X',
        roleName: options.roleName ?? 'Tester',
        scopeType: 'GLOBAL',
        scopeId: null,
        scopeMode: 'ORGANIZATIONAL',
      },
    ],
    permissions: options.permissions ?? [],
    grants: Object.fromEntries(
      (options.permissions ?? []).map((p) => [p, [{ scope: 'GLOBAL' as const }]]),
    ),
    portals: options.portals ?? [],
    sessionId: '0196f000-0000-7000-8000-0000000000cc',
  };
}

export function signInAs(me: MeDto, token = 'test-access-token') {
  useAuthStore.setState({ status: 'authenticated', accessToken: token, me, endReason: null });
}

export function signOutStore(endReason: 'signed-out' | 'expired' | null = null) {
  useAuthStore.setState({ status: 'anonymous', accessToken: null, me: null, endReason });
}

/** Renders the real route tree at a path with a fresh, retry-free query client. */
export function renderRoute(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...view, router };
}
