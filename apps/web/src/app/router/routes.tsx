import type { RouteObject } from 'react-router';
import { CenteredLayout } from '@/app/layouts/centered-layout';
import { ForbiddenPage, NotFoundPage, RouteErrorPage } from '@/pages/error-pages';

/**
 * Route tree. Portal routes (/admin, /faculty, /student) and /login are
 * added with their guards in Phase 2 onwards (docs/USER_ROLES_AND_PERMISSIONS.md §7).
 */
export const routes: RouteObject[] = [
  {
    element: <CenteredLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        index: true,
        lazy: async () => {
          const { SystemStatusPage } =
            await import('@/features/system/components/system-status-page');
          return { Component: SystemStatusPage };
        },
      },
      { path: '403', element: <ForbiddenPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
