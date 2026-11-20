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
              path: 'university',
              handle: crumb('University'),
              lazy: lazyPage(async () => ({
                default: (await import('@/features/structure/pages/university-page'))
                  .UniversityPage,
              })),
            },
            {
              path: 'schools',
              handle: crumb('Faculties'),
              children: [
                {
                  index: true,
                  lazy: lazyPage(async () => ({
                    default: (await import('@/features/structure/pages/schools-pages')).SchoolsPage,
                  })),
                },
                {
                  path: ':schoolId',
                  handle: crumb('Faculty'),
                  lazy: lazyPage(async () => ({
                    default: (await import('@/features/structure/pages/schools-pages'))
                      .SchoolDetailPage,
                  })),
                },
              ],
            },
            {
              path: 'departments',
              handle: crumb('Departments'),
              children: [
                {
                  index: true,
                  lazy: lazyPage(async () => ({
                    default: (await import('@/features/structure/pages/departments-pages'))
                      .DepartmentsPage,
                  })),
                },
                {
                  path: ':departmentId',
                  handle: crumb('Department'),
                  lazy: lazyPage(async () => ({
                    default: (await import('@/features/structure/pages/departments-pages'))
                      .DepartmentDetailPage,
                  })),
                },
              ],
            },
            {
              path: 'degrees',
              handle: crumb('Degrees'),
              lazy: lazyPage(async () => ({
                default: (await import('@/features/structure/pages/degrees-page')).DegreesPage,
              })),
            },
            {
              path: 'programs',
              handle: crumb('Programs'),
              children: [
                {
                  index: true,
                  lazy: lazyPage(async () => ({
                    default: (await import('@/features/structure/pages/programs-pages'))
                      .ProgramsPage,
                  })),
                },
                {
                  path: ':programId',
                  handle: crumb('Program'),
                  lazy: lazyPage(async () => ({
                    default: (await import('@/features/structure/pages/programs-pages'))
                      .ProgramDetailPage,
                  })),
                },
              ],
            },
            {
              path: 'courses',
              handle: crumb('Courses'),
              children: [
                {
                  index: true,
                  lazy: lazyPage(async () => ({
                    default: (await import('@/features/courses/pages/courses-pages')).CoursesPage,
                  })),
                },
                {
                  path: ':courseId',
                  handle: crumb('Course'),
                  lazy: lazyPage(async () => ({
                    default: (await import('@/features/courses/pages/courses-pages'))
                      .CourseDetailPage,
                  })),
                },
              ],
            },
            {
              path: 'sections',
              handle: crumb('Sections'),
              children: [
                {
                  index: true,
                  lazy: lazyPage(async () => ({
                    default: (await import('@/features/courses/pages/sections-pages')).SectionsPage,
                  })),
                },
                {
                  path: ':sectionId',
                  handle: crumb('Section'),
                  lazy: lazyPage(async () => ({
                    default: (await import('@/features/courses/pages/sections-pages'))
                      .SectionDetailPage,
                  })),
                },
              ],
            },
            {
              path: 'classrooms',
              handle: crumb('Classrooms'),
              children: [
                {
                  index: true,
                  lazy: lazyPage(async () => ({
                    default: (await import('@/features/courses/pages/classrooms-pages'))
                      .ClassroomsPage,
                  })),
                },
                {
                  path: ':classroomId',
                  handle: crumb('Classroom'),
                  lazy: lazyPage(async () => ({
                    default: (await import('@/features/courses/pages/classrooms-pages'))
                      .ClassroomDetailPage,
                  })),
                },
              ],
            },
            {
              element: <RequirePermission permission="registration:read" />,
              children: [
                {
                  path: 'registrations',
                  handle: crumb('Registrations'),
                  children: [
                    {
                      index: true,
                      lazy: lazyPage(async () => ({
                        default: (
                          await import('@/features/registrations/pages/registrations-pages')
                        ).RegistrationsPage,
                      })),
                    },
                    {
                      path: ':registrationId',
                      handle: crumb('Registration'),
                      lazy: lazyPage(async () => ({
                        default: (
                          await import('@/features/registrations/pages/registrations-pages')
                        ).RegistrationDetailPage,
                      })),
                    },
                  ],
                },
              ],
            },
            {
              path: 'academic-sessions',
              handle: crumb('Academic calendar'),
              children: [
                {
                  index: true,
                  lazy: lazyPage(async () => ({
                    default: (await import('@/features/calendar/pages/sessions-page')).SessionsPage,
                  })),
                },
                {
                  path: ':sessionId',
                  handle: crumb('Session'),
                  lazy: lazyPage(async () => ({
                    default: (await import('@/features/calendar/pages/session-detail-page'))
                      .SessionDetailPage,
                  })),
                },
              ],
            },
            {
              path: 'grading-scales',
              handle: crumb('Grading scales'),
              lazy: lazyPage(async () => ({
                default: (await import('@/features/calendar/pages/grading-scales-page'))
                  .GradingScalesPage,
              })),
            },
            {
              element: <RequirePermission permission="student:read" />,
              children: [
                {
                  path: 'students',
                  handle: crumb('Students'),
                  children: [
                    {
                      index: true,
                      lazy: lazyPage(async () => ({
                        default: (await import('@/features/people/pages/students-pages'))
                          .StudentsPage,
                      })),
                    },
                    {
                      path: ':studentId',
                      handle: crumb('Student'),
                      lazy: lazyPage(async () => ({
                        default: (await import('@/features/people/pages/students-pages'))
                          .StudentDetailPage,
                      })),
                    },
                  ],
                },
              ],
            },
            {
              element: <RequirePermission permission="faculty:read" />,
              children: [
                {
                  path: 'faculty',
                  handle: crumb('Faculty'),
                  children: [
                    {
                      index: true,
                      lazy: lazyPage(async () => ({
                        default: (await import('@/features/people/pages/faculty-pages'))
                          .FacultyPage,
                      })),
                    },
                    {
                      path: ':facultyId',
                      handle: crumb('Faculty member'),
                      lazy: lazyPage(async () => ({
                        default: (await import('@/features/people/pages/faculty-pages'))
                          .FacultyDetailPage,
                      })),
                    },
                  ],
                },
              ],
            },
            {
              element: <RequirePermission permission="admin:manage" />,
              children: [
                {
                  path: 'administrators',
                  handle: crumb('Administrators'),
                  children: [
                    {
                      index: true,
                      lazy: lazyPage(async () => ({
                        default: (await import('@/features/people/pages/administrators-pages'))
                          .AdministratorsPage,
                      })),
                    },
                    {
                      path: ':adminId',
                      handle: crumb('Administrator'),
                      lazy: lazyPage(async () => ({
                        default: (await import('@/features/people/pages/administrators-pages'))
                          .AdministratorDetailPage,
                      })),
                    },
                  ],
                },
              ],
            },
            {
              // Import permission depends on the kind; the API checks it per request.
              path: 'imports',
              handle: crumb('Imports'),
              children: [
                {
                  path: 'new',
                  handle: crumb('New import'),
                  lazy: lazyPage(async () => ({
                    default: (await import('@/features/imports/pages/import-pages')).NewImportPage,
                  })),
                },
                {
                  path: ':importId',
                  handle: crumb('Import'),
                  lazy: lazyPage(async () => ({
                    default: (await import('@/features/imports/pages/import-pages'))
                      .ImportDetailPage,
                  })),
                },
              ],
            },
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
          portalRoutes('faculty', 'Faculty', [
            {
              path: 'teaching',
              handle: crumb('My teaching'),
              lazy: lazyPage(async () => ({
                default: (await import('@/features/teaching/pages/teaching-pages')).MyTeachingPage,
              })),
            },
            {
              path: 'sections/:sectionId',
              handle: crumb('Section'),
              lazy: lazyPage(async () => ({
                default: (await import('@/features/teaching/pages/teaching-pages'))
                  .SectionWorkspacePage,
              })),
            },
            {
              path: 'announcements',
              handle: crumb('Announcements'),
              lazy: lazyPage(async () => ({
                default: (await import('@/features/teaching/pages/teaching-pages'))
                  .FacultyAnnouncementsPage,
              })),
            },
            {
              path: 'profile',
              handle: crumb('Profile'),
              lazy: lazyPage(async () => ({
                default: (await import('@/features/profile/pages/profile-pages'))
                  .FacultyProfilePage,
              })),
            },
          ]),
          portalRoutes('student', 'Student', [
            {
              path: 'profile',
              handle: crumb('Profile'),
              lazy: lazyPage(async () => ({
                default: (await import('@/features/profile/pages/profile-pages'))
                  .StudentProfilePage,
              })),
            },
          ]),
        ],
      },
      { element: <CenteredLayout />, children: [{ path: '*', element: <NotFoundPage /> }] },
    ],
  },
];
