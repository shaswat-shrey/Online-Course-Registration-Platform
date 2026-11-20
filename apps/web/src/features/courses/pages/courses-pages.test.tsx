import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, envelope, failure, server } from '@/tests/msw-server';
import { makeMe, renderRoute, signInAs } from '@/tests/render';

const page = <T,>(data: T[]) => ({
  success: true,
  message: 'OK',
  data,
  meta: { page: 1, limit: 25, total: data.length, totalPages: 1 },
});
const id = (n: number) => `0196f000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const dept = { id: id(1), code: 'CS', name: 'Computer Science' };
const course = (n: number, code: string, title: string) => ({
  id: id(100 + n),
  code,
  title,
  description: null,
  department: dept,
  credits: 4,
  level: 300,
  category: 'CORE',
  recommendedYear: 3,
  recommendedSessionType: 'FALL',
  defaultCapacity: 40,
  minEnrollment: 8,
  coordinator: null,
  isRepeatable: false,
  status: 'ACTIVE',
  sectionCount: 1,
  hasPrerequisites: true,
  canManage: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});
const ref = (c: ReturnType<typeof course>) => ({
  id: c.id,
  code: c.code,
  title: c.title,
  credits: 4,
  status: 'ACTIVE',
});
const algorithms = course(1, 'CS301', 'Design and Analysis of Algorithms');
const capstone = course(2, 'CS490', 'Capstone Project');
const detail = {
  ...algorithms,
  syllabus: null,
  outcomes: ['Analyse algorithms'],
  assessmentComponents: [{ name: 'Exam', weight: 60 }],
  prerequisites: [],
  corequisites: [],
  requiredBy: [ref(capstone)],
  programs: [],
  specializations: [],
  restrictions: [],
  requirementGroups: [],
  sectionsByStatus: { PUBLISHED: 1 },
  canArchive: true,
};
const baseHandlers = [
  http.get(`${API}/departments`, () => HttpResponse.json(page([]))),
  http.get(`${API}/programs`, () => HttpResponse.json(page([]))),
  http.get(`${API}/academic-sessions`, () => HttpResponse.json(envelope([]))),
  http.get(`${API}/course-sections`, () => HttpResponse.json(page([]))),
];

describe('CoursesPage', () => {
  it('searches the catalog through the URL and hides creation without permission', async () => {
    const calls: URLSearchParams[] = [];
    server.use(
      ...baseHandlers,
      http.get(`${API}/courses`, ({ request }) => {
        calls.push(new URL(request.url).searchParams);
        return HttpResponse.json(page([algorithms]));
      }),
    );
    signInAs(makeMe({ portals: ['admin'], permissions: ['dashboard:admin'] }));
    const { router } = renderRoute('/admin/courses');

    expect(await screen.findByText(/Design and Analysis of Algorithms/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new course/i })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search courses'), 'graphs');
    await waitFor(() => expect(router.state.location.search).toBe('?q=graphs'));
    await waitFor(() => expect(calls.at(-1)?.get('q')).toBe('graphs'));
  });
});

describe('CourseDetailPage', () => {
  it('shows a prerequisite cycle rejected by the server inside the builder', async () => {
    let body: unknown;
    server.use(
      ...baseHandlers,
      http.get(`${API}/courses/:id`, () => HttpResponse.json(envelope(detail))),
      http.get(`${API}/courses`, () => HttpResponse.json(page([capstone]))),
      http.put(`${API}/courses/:id/prerequisites`, async ({ request }) => {
        body = await request.json();
        return failure(
          'PREREQUISITE_CYCLE',
          'This would create a prerequisite cycle: CS301 → CS490 → CS301',
          409,
          {
            cycle: ['CS301', 'CS490', 'CS301'],
          },
        );
      }),
    );
    signInAs(makeMe({ portals: ['admin'], permissions: ['dashboard:admin', 'course:update'] }));
    renderRoute(`/admin/courses/${algorithms.id}`);

    await userEvent.click(await screen.findByRole('tab', { name: 'Prerequisites' }));
    await userEvent.click(
      within(screen.getByRole('tabpanel')).getAllByRole('button', { name: 'Edit' })[0]!,
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /add requirement group/i }));
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Group 1 course 1' }));
    await userEvent.click(await screen.findByRole('option', { name: /CS490/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save prerequisites' }));

    expect(await within(dialog).findByText(/CS301 → CS490 → CS301/)).toBeInTheDocument();
    expect(body).toEqual({
      groups: [{ items: [{ courseId: capstone.id, minGradeLetter: null }] }],
    });
  });
});

const section = {
  id: id(500),
  sectionCode: 'A',
  course: { ...ref(algorithms), category: 'CORE', department: dept },
  session: {
    id: id(600),
    code: 'FALL-2026',
    name: 'Fall 2026',
    status: 'ACTIVE',
    startDate: '2026-08-03',
    endDate: '2026-12-18',
  },
  campus: null,
  capacity: 40,
  enrolledCount: 0,
  availableSeats: 40,
  waitlistCapacity: 10,
  waitlistCount: 0,
  status: 'DRAFT',
  registrationOpen: true,
  notes: null,
  publishedAt: null,
  cancelledAt: null,
  cancelReason: null,
  scheduleOverrideReason: null,
  meetings: [
    {
      id: id(700),
      dayOfWeek: 2,
      startMinute: 840,
      endMinute: 930,
      type: 'LECTURE',
      classroom: { id: id(800), label: 'Block B B-101', capacity: 60 },
    },
  ],
  instructors: [],
  hasRestrictions: false,
  permissions: {
    update: true,
    publish: true,
    cancel: true,
    assignFaculty: true,
    overrideConflicts: true,
  },
  restrictions: [],
};

describe('SectionDetailPage', () => {
  it('surfaces classroom conflicts and resubmits with an override reason (FR-CRS-007)', async () => {
    const bodies: Array<{ override: { reason: string } | null }> = [];
    server.use(
      ...baseHandlers,
      http.get(`${API}/course-sections/:id`, () => HttpResponse.json(envelope(section))),
      http.put(`${API}/course-sections/:id/meetings`, async ({ request }) => {
        const body = (await request.json()) as { override: { reason: string } | null };
        bodies.push(body);
        if (!body.override)
          return failure('CLASSROOM_CONFLICT', 'A classroom is already booked at this time', 409, {
            canOverride: true,
            conflicts: [
              {
                kind: 'CLASSROOM',
                resource: 'Block B B-101',
                resourceId: id(800),
                dayOfWeek: 2,
                startMinute: 840,
                endMinute: 930,
                section: { id: id(501), sectionCode: 'A', courseCode: 'AIDS201' },
              },
            ],
          });
        return HttpResponse.json(envelope({ ...section, warnings: [], overriddenConflicts: [{}] }));
      }),
    );
    signInAs(
      makeMe({
        portals: ['admin'],
        permissions: ['dashboard:admin', 'section:update', 'section:override_conflicts'],
      }),
    );
    renderRoute(`/admin/sections/${section.id}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Edit meetings' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save meetings' }));
    expect(
      await within(dialog).findByText(/is booked Tue 14:00–15:30 by AIDS201 A/),
    ).toBeInTheDocument();

    await userEvent.type(
      within(dialog).getByLabelText('Reason for overriding'),
      'Combined guest lecture',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]!.override).toEqual({ reason: 'Combined guest lecture' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('warns about a missing primary instructor on a draft', async () => {
    server.use(
      ...baseHandlers,
      http.get(`${API}/course-sections/:id`, () => HttpResponse.json(envelope(section))),
    );
    signInAs(makeMe({ portals: ['admin'], permissions: ['dashboard:admin', 'section:update'] }));
    renderRoute(`/admin/sections/${section.id}`);
    expect(
      await screen.findByText(/Assign a primary instructor before publishing/),
    ).toBeInTheDocument();
  });
});
