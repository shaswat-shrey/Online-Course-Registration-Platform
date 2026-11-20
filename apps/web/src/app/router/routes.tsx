import type { RouteObject } from 'react-router';
import type { Portal } from '@ucrams/shared';
import {
  HomeRedirect,
  PublicOnly,
  RequireAuth,
  RequirePermission,
  RequirePortal,
} from '@/app/guards/guards';
import { AuthLayout } from '@/app/layouts/auth-layout';
import { CenteredLayout } from '@/app/layouts/centered-layout';
import { PortalLayout } from '@/app/layouts/portal-layout';
import type { RouteHandle } from '@/components/navigation/breadcrumbs';
import { ForbiddenPage, NotFoundPage, RouteErrorPage } from '@/pages/error-pages';

const lazyPage = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({
  Component: (await load()).default,
});

const overview = (portal: Portal) =>
  lazyPage(async () => {
    const { OverviewPage } = await import('@/features/overview/pages/overview-page');
    return { default: () => <OverviewPage portal={portal} /> };
  });
const account = lazyPage(async () => ({
  default: (await import('@/features/account/pages/account-security-page')).AccountSecurityPage,
}));

const crumb = (label: string): RouteHandle => ({ crumb: label });

function portalRoutes(portal: Portal, label: string, extra: RouteObject[] = []): RouteObject {
  return {
    path: portal,
    element: <RequirePortal portal={portal} />,
    handle: crumb(label),
    children: [
      {
        element: <PortalLayout portal={portal} />,
        children: [
          { index: true, element: <HomeRedirect /> },
          { path: 'dashboard', lazy: overview(portal), handle: crumb('Overview') },
          { path: 'account', lazy: account, handle: crumb('Account security') },
          ...extra,
        ],
      },
    ],
  };
}

/** Route tree: public auth pages, then guarded portals (USER_ROLES_AND_PERMISSIONS.md §7). */
export const routes: RouteObject[] = [
  {
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <HomeRedirect /> },
      {
        element: <PublicOnly />,
        children: [
          {
            element: <AuthLayout />,
            children: [
              {
                path: 'login',
                lazy: lazyPage(async () => ({
                  default: (await import('@/features/auth/pages/login-page')).LoginPage,
                })),
              },
              {
                path: 'forgot-password',
                lazy: lazyPage(async () => ({
                  default: (await import('@/features/auth/pages/forgot-password-page'))
                    .ForgotPasswordPage,
                })),
              },
            ],
          },
        ],
      },
      {
        // Token pages work whether or not someone is signed in on this browser.
        element: <AuthLayout />,
        children: [
          {
            path: 'reset-password',
            lazy: lazyPage(async () => ({
              default: (await import('@/features/auth/pages/token-pages')).ResetPasswordPage,
            })),
          },
          {
            path: 'accept-invite',
            lazy: lazyPage(async () => ({
              default: (await import('@/features/auth/pages/token-pages')).AcceptInvitePage,
            })),
          },
        ],
      },
      {
        element: <CenteredLayout />,
        children: [
          {
            path: 'status',
            lazy: lazyPage(async () => ({
              default: (await import('@/features/system/components/system-status-page'))
                .SystemStatusPage,
            })),
          },
          { path: '403', element: <ForbiddenPage /> },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AuthLayout />,
            children: [
              {
                path: 'no-access',
                lazy: lazyPage(async () => ({
                  default: (await import('@/features/auth/pages/no-access-page')).NoAccessPage,
                })),
              },
            ],
          },
          portalRoutes('admin', 'Administration', [
            {
              element: <RequirePermission permission="rbac:read" />,
              children: [
                {
                  path: 'roles',
                  handle: crumb('Roles & permissions'),
                  children: [
                    {
                      index: true,
                      lazy: lazyPage(async () => ({
                        default: (await import('@/features/rbac/pages/roles-page')).RolesPage,
                      })),
                    },
                    {
                      path: ':roleId',
                      handle: crumb('Role'),
                      lazy: lazyPage(async () => ({
                        default: (await import('@/features/rbac/pages/role-detail-page'))
                          .RoleDetailPage,
                      })),
                    },
                  ],
                },
              ],
            },
            {
              element: <RequirePermission permission="audit:read" />,
              children: [
                {
                  path: 'audit-logs',
                  handle: crumb('Audit log'),
                  lazy: lazyPage(async () => ({
                    default: (await import('@/features/audit/pages/audit-log-page')).AuditLogPage,
                  })),
                },
              ],
            },
          ]),
          portalRoutes('faculty', 'Faculty'),
          portalRoutes('student', 'Student'),
        ],
      },
      { element: <CenteredLayout />, children: [{ path: '*', element: <NotFoundPage /> }] },
    ],
  },
];
