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

/** Communication pages are shared by the portals; the portal decides links and labels. */
const comm = (load: () => Promise<object>, name: string, portal: Portal) =>
  lazyPage(async () => {
    const Page = (await load())[name as keyof object] as React.ComponentType<{ portal: Portal }>;
    return { default: () => <Page portal={portal} /> };
  });
const messagesPage = () => import('@/features/communication/pages/messages-page');
const discussionPages = () => import('@/features/communication/pages/discussion-pages');
const casePages = () => import('@/features/communication/pages/case-pages');
const announcementPages = () => import('@/features/communication/pages/announcement-pages');
const academicPage = (name: string) =>
  lazyPage(async () => ({
    default: (await import('@/features/academics/pages/academic-pages'))[
      name as 'MyTranscriptPage'
    ] as React.ComponentType,
  }));

/** Messaging, discussions, feedback and support for students and faculty (Phase 9). */
const memberCommunication = (portal: 'faculty' | 'student'): RouteObject[] => [
  { path: 'messages', handle: crumb('Messages'), lazy: comm(messagesPage, 'MessagesPage', portal) },
  {
    path: 'discussions',
    handle: crumb('Discussions'),
    children: [
      { index: true, lazy: comm(discussionPages, 'DiscussionsPage', portal) },
      {
        path: ':threadId',
        handle: crumb('Thread'),
        lazy: comm(discussionPages, 'ThreadPage', portal),
      },
    ],
  },
  {
    path: 'feedback',
    handle: crumb('Feedback'),
    children: [
      { index: true, lazy: comm(casePages, 'MyFeedbackPage', portal) },
      {
        path: ':feedbackId',
        handle: crumb('Feedback'),
        lazy: comm(casePages, 'FeedbackDetailPage', portal),
      },
    ],
  },
  {
    path: 'support',
    handle: crumb('Support'),
    children: [
      { index: true, lazy: comm(casePages, 'MyTicketsPage', portal) },
      {
        path: ':ticketId',
        handle: crumb('Ticket'),
        lazy: comm(casePages, 'TicketDetailPage', portal),
      },
    ],
  },
];

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
            {
              path: 'messages',
              handle: crumb('Messages'),
              lazy: comm(messagesPage, 'MessagesPage', 'admin'),
            },
            {
              path: 'room-availability',
              handle: crumb('Room availability'),
              lazy: academicPage('ClassroomAvailabilityPage'),
            },
            {
              element: <RequirePermission permission="grade:approve" />,
              children: [
                {
                  path: 'grades',
                  handle: crumb('Final grades'),
                  children: [
                    { index: true, lazy: academicPage('GradeApprovalsPage') },
                    {
                      path: ':sectionId',
                      handle: crumb('Grade sheet'),
                      lazy: academicPage('AdminGradeSheetPage'),
                    },
                  ],
                },
              ],
            },
            {
              element: <RequirePermission permission="record:read" />,
              children: [
                {
                  path: 'students/:studentId/transcript',
                  handle: crumb('Transcript'),
                  lazy: academicPage('StudentTranscriptPage'),
                },
              ],
            },
            {
              path: 'announcements',
              handle: crumb('Announcements'),
              lazy: comm(announcementPages, 'AdminAnnouncementsPage', 'admin'),
            },
            {
              element: <RequirePermission permission="feedback:manage" />,
              children: [
                {
                  path: 'feedback',
                  handle: crumb('Feedback'),
                  children: [
                    { index: true, lazy: comm(casePages, 'FeedbackQueuePage', 'admin') },
                    {
                      path: ':feedbackId',
                      handle: crumb('Feedback'),
                      lazy: comm(casePages, 'FeedbackDetailPage', 'admin'),
                    },
                  ],
                },
              ],
            },
            {
              element: <RequirePermission permission="ticket:manage" />,
              children: [
                {
                  path: 'tickets',
                  handle: crumb('Support tickets'),
                  children: [
                    { index: true, lazy: comm(casePages, 'TicketQueuePage', 'admin') },
                    {
                      path: ':ticketId',
                      handle: crumb('Ticket'),
                      lazy: comm(casePages, 'TicketDetailPage', 'admin'),
                    },
                  ],
                },
              ],
            },
          ]),
          portalRoutes('faculty', 'Faculty', [
            ...memberCommunication('faculty'),
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
            ...memberCommunication('student'),
            {
              path: 'transcript',
              handle: crumb('Transcript'),
              lazy: academicPage('MyTranscriptPage'),
            },
            {
              path: 'catalog',
              handle: crumb('Catalog'),
              lazy: lazyPage(async () => ({
                default: (await import('@/features/student/pages/student-pages')).CatalogPage,
              })),
            },
            {
              path: 'catalog/:courseId',
              handle: crumb('Course'),
              lazy: lazyPage(async () => ({
                default: (await import('@/features/student/pages/student-pages')).CatalogCoursePage,
              })),
            },
            {
              path: 'registrations',
              handle: crumb('My registrations'),
              lazy: lazyPage(async () => ({
                default: (await import('@/features/student/pages/student-pages'))
                  .MyRegistrationsPage,
              })),
            },
            {
              path: 'timetable',
              handle: crumb('Timetable'),
              lazy: lazyPage(async () => ({
                default: (await import('@/features/student/pages/student-pages')).TimetablePage,
              })),
            },
            {
              path: 'planner',
              handle: crumb('Planner'),
              lazy: lazyPage(async () => ({
                default: (await import('@/features/student/pages/student-pages')).PlannerPage,
              })),
            },
            {
              path: 'progress',
              handle: crumb('Degree progress'),
              lazy: lazyPage(async () => ({
                default: (await import('@/features/student/pages/student-pages')).ProgressPage,
              })),
            },
            {
              path: 'history',
              handle: crumb('Academic history'),
              lazy: lazyPage(async () => ({
                default: (await import('@/features/student/pages/student-pages')).HistoryPage,
              })),
            },
            {
              path: 'announcements',
              handle: crumb('Announcements'),
              lazy: lazyPage(async () => ({
                default: (await announcementPages()).AnnouncementsPage,
              })),
            },
            {
              path: 'courses/:sectionId',
              handle: crumb('Course'),
              lazy: lazyPage(async () => ({
                default: (await import('@/features/student/pages/student-pages')).StudentCoursePage,
              })),
            },
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
