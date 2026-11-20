import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, envelope, server } from '@/tests/msw-server';
import { makeMe, renderRoute, signInAs } from '@/tests/render';

const id = (n: number) => `0196f000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const section = {
  id: id(1),
  sectionCode: 'B',
  course: {
    id: id(2),
    code: 'CS101',
    title: 'Programming Fundamentals',
    credits: 4,
    status: 'ACTIVE',
    category: 'CORE',
    department: { id: id(3), code: 'CS', name: 'Computer Science' },
  },
  session: {
    id: id(4),
    code: 'FALL-2026',
    name: 'Fall 2026',
    status: 'ACTIVE',
    startDate: '2026-08-03',
    endDate: '2026-12-18',
  },
  campus: null,
  capacity: 60,
  enrolledCount: 29,
  availableSeats: 31,
  waitlistCapacity: 10,
  waitlistCount: 0,
  status: 'PUBLISHED',
  registrationOpen: true,
  notes: null,
  publishedAt: null,
  cancelledAt: null,
  cancelReason: null,
  scheduleOverrideReason: null,
  meetings: [
    {
      id: id(5),
      dayOfWeek: 5,
      startMinute: 540,
      endMinute: 600,
      type: 'LECTURE',
      classroom: { id: id(6), label: 'Block A A-101', capacity: 70 },
    },
  ],
  instructors: [
    {
      facultyMemberId: id(7),
      name: 'Farhan Faculty',
      email: 'f@test.edu',
      designation: 'PROFESSOR',
      role: 'PRIMARY',
    },
  ],
  hasRestrictions: false,
  permissions: {
    update: false,
    publish: false,
    cancel: false,
    assignFaculty: false,
    overrideConflicts: false,
  },
  myRole: 'PRIMARY',
};
const faculty = () =>
  makeMe({
    portals: ['faculty'],
    permissions: ['roster:read', 'material:manage', 'announcement:publish_section'],
  });
const base = [
  http.get(`${API}/notifications/unread-count`, () => HttpResponse.json(envelope({ unread: 0 }))),
];

describe('faculty portal', () => {
  it('shows the teaching dashboard on the faculty overview (FR-FACULTY-001)', async () => {
    server.use(
      ...base,
      http.get(`${API}/faculty/me/dashboard`, () =>
        HttpResponse.json(
          envelope({
            session: section.session,
            sections: [section],
            totalStudents: 29,
            today: {
              dayOfWeek: 5,
              nowMinute: 560,
              timeZone: 'Asia/Kolkata',
              classes: [
                {
                  sectionId: id(1),
                  course: 'CS101',
                  sectionCode: 'B',
                  title: 'Programming Fundamentals',
                  startMinute: 540,
                  endMinute: 600,
                  classroom: 'Block A A-101',
                  type: 'LECTURE',
                },
              ],
            },
            load: { credits: 4, maxCredits: 12 },
            upcomingSections: 2,
            recentAnnouncements: [],
          }),
        ),
      ),
      http.get(`${API}/auth/sessions`, () => HttpResponse.json(envelope([]))),
      http.get(`${API}/auth/login-history`, () => HttpResponse.json(envelope([]))),
    );
    signInAs(faculty());
    renderRoute('/faculty/dashboard');
    expect(await screen.findByText('Students taught')).toBeInTheDocument();
    expect(screen.getByText('4 of 12 credits')).toBeInTheDocument();
    expect(screen.getByText('Now')).toBeInTheDocument();
  });

  it('publishes an announcement to the chosen sections (FR-FACULTY-008)', async () => {
    let body: unknown;
    server.use(
      ...base,
      http.get(`${API}/announcements/mine`, () => HttpResponse.json(envelope([]))),
      http.get(`${API}/faculty/me/sections`, () => HttpResponse.json(envelope([section]))),
      http.post(`${API}/announcements`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          envelope({
            id: id(9),
            title: 'Quiz',
            body: 'Friday',
            priority: 'NORMAL',
            pinned: false,
            publishedAt: '2026-11-20T10:00:00Z',
            expiresAt: null,
            author: 'Farhan Faculty',
            mine: true,
            sections: [{ id: id(1), label: 'CS101 B' }],
          }),
          { status: 201 },
        );
      }),
    );
    signInAs(faculty());
    renderRoute('/faculty/announcements');
    await userEvent.click(await screen.findByRole('button', { name: /new announcement/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Quiz on Friday');
    await userEvent.type(within(dialog).getByLabelText('Message'), 'Chapters 1 to 3.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    expect(await within(dialog).findByText('Choose at least one section.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'CS101 B' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    await waitFor(() =>
      expect(body).toEqual({
        title: 'Quiz on Friday',
        body: 'Chapters 1 to 3.',
        priority: 'NORMAL',
        pinned: false,
        sectionIds: [id(1)],
      }),
    );
  });

  it('offers the roster export only with roster:export', async () => {
    server.use(
      ...base,
      http.get(`${API}/course-sections/:id/workspace`, () =>
        HttpResponse.json(
          envelope({
            section,
            course: {
              description: 'Intro',
              syllabus: null,
              level: 100,
              outcomes: [],
              assessmentComponents: [],
            },
            stats: {
              byStatus: { REGISTERED: 1 },
              byProgram: [{ label: 'BTECH-CS', count: 1 }],
              byYear: [{ label: 'Year 1', count: 1 }],
            },
            myRole: 'PRIMARY',
            can: { exportRoster: false, manageMaterials: true, announce: true },
          }),
        ),
      ),
      http.get(`${API}/course-sections/:id/roster`, () =>
        HttpResponse.json({
          success: true,
          message: 'OK',
          data: [
            {
              registrationId: id(10),
              status: 'REGISTERED',
              registeredAt: '2026-07-20T06:00:00Z',
              student: {
                id: id(11),
                studentNumber: '26CS0001',
                name: 'Asha Rao',
                email: 'asha@test.edu',
                program: { code: 'BTECH-CS', name: 'B.Tech CS' },
                specialization: null,
                yearOfStudy: 1,
              },
              attendancePercent: null,
            },
          ],
          meta: { page: 1, limit: 25, total: 1, totalPages: 1 },
        }),
      ),
    );
    signInAs(faculty());
    renderRoute(`/faculty/sections/${id(1)}?tab=roster`);
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /export csv/i })).not.toBeInTheDocument();
  });
});
