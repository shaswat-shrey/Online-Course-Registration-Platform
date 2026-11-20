import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { MeDto } from '@ucrams/shared';
import { API, envelope, server } from '@/tests/msw-server';
import { makeMe, renderRoute, signInAs } from '@/tests/render';

const page = <T,>(data: T[]) => ({
  success: true,
  message: 'OK',
  data,
  meta: { page: 1, limit: 25, total: data.length, totalPages: 1 },
});
const emptyLists = [
  http.get(`${API}/schools`, () => HttpResponse.json(page([]))),
  http.get(`${API}/departments`, () => HttpResponse.json(page([]))),
  http.get(`${API}/programs`, () => HttpResponse.json(page([]))),
];
const cs = { id: '0196f000-0000-7000-8000-00000000d001', code: 'CS', name: 'Computer Science' };
const student = {
  id: '0196f000-0000-7000-8000-00000000e001',
  studentNumber: '25CS0001',
  firstName: 'Asha',
  lastName: 'Rao',
  email: 'asha@test.edu',
  program: { id: '0196f000-0000-7000-8000-00000000f001', code: 'BTCS', name: 'B.Tech CS' },
  department: cs,
  specialization: null,
  yearOfStudy: 2,
  status: 'ACTIVE',
  accountStatus: 'ACTIVE',
  activeHolds: 1,
};

describe('StudentsPage', () => {
  it('lists students, sends search to the API, and hides creation without permission', async () => {
    const calls: URLSearchParams[] = [];
    server.use(
      ...emptyLists,
      http.get(`${API}/students`, ({ request }) => {
        calls.push(new URL(request.url).searchParams);
        return HttpResponse.json(page([student]));
      }),
    );
    signInAs(makeMe({ portals: ['admin'], permissions: ['dashboard:admin', 'student:read'] }));
    const { router } = renderRoute('/admin/students');

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByText('25CS0001')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new student/i })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Search students'), 'asha');
    await waitFor(() => expect(router.state.location.search).toBe('?q=asha'));
    await waitFor(() => expect(calls.at(-1)?.get('q')).toBe('asha'));
  });

  it('is forbidden without student:read', async () => {
    signInAs(makeMe({ portals: ['admin'], permissions: ['dashboard:admin'] }));
    const { router } = renderRoute('/admin/students');
    await waitFor(() => expect(router.state.location.pathname).toBe('/403'));
  });
});

const job = (over: object = {}) => ({
  id: '0196f000-0000-7000-8000-00000000a0a1',
  kind: 'STUDENTS',
  status: 'PREVIEW',
  fileName: 'students.csv',
  sendInvites: true,
  totalRows: 3,
  validRows: 2,
  invalidRows: 1,
  createdRows: 0,
  failedRows: 0,
  createdBy: 'Pat Tester',
  createdAt: '2026-11-20T10:00:00Z',
  startedAt: null,
  finishedAt: null,
  errorMessage: null,
  ...over,
});

describe('Imports', () => {
  it('uploads a file, shows problem rows first, and commits with the invitation choice', async () => {
    let commitBody: unknown;
    const rowCalls: URLSearchParams[] = [];
    server.use(
      http.post(`${API}/imports/students/preview`, () => HttpResponse.json(envelope(job()))),
      http.get(`${API}/imports/:id`, () => HttpResponse.json(envelope(job()))),
      http.get(`${API}/imports/:id/rows`, ({ request }) => {
        rowCalls.push(new URL(request.url).searchParams);
        return HttpResponse.json(
          page([
            {
              rowNumber: 3,
              status: 'INVALID',
              email: 'bad@test.edu',
              name: 'Bad Row',
              reference: 'NOPE',
              errors: [{ field: 'program_code', message: 'Unknown program' }],
              userId: null,
            },
          ]),
        );
      }),
      http.post(`${API}/imports/:id/commit`, async ({ request }) => {
        commitBody = await request.json();
        return HttpResponse.json(envelope(job({ status: 'QUEUED' })));
      }),
    );
    signInAs(makeMe({ portals: ['admin'], permissions: ['dashboard:admin', 'student:import'] }));
    const { router } = renderRoute('/admin/imports/new?kind=students');

    const file = new File(['email,first_name\n'], 'students.csv', { type: 'text/csv' });
    await userEvent.upload(await screen.findByLabelText('Choose an import file'), file);
    await userEvent.click(screen.getByRole('button', { name: /check file/i }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        '/admin/imports/0196f000-0000-7000-8000-00000000a0a1',
      ),
    );
    expect(await screen.findByText(/Unknown program/)).toBeInTheDocument();
    expect(rowCalls[0]?.get('status')).toBe('INVALID');

    await userEvent.click(screen.getByLabelText('Email invitations when done'));
    await userEvent.click(screen.getByRole('button', { name: /create 2 account/i }));
    await waitFor(() => expect(commitBody).toEqual({ sendInvites: false }));
    expect(await screen.findByText('Queued')).toBeInTheDocument();
  });
});

describe('StudentProfilePage', () => {
  it('shows the record and saves contact changes', async () => {
    let patch: unknown;
    const detail = {
      ...student,
      userId: '0196f000-0000-7000-8000-0000000000aa',
      avatarUrl: null,
      program: { ...student.program, totalCredits: 160 },
      department: { ...cs, schoolId: '0196f000-0000-7000-8000-00000000a001' },
      admissionSession: null,
      admissionDate: null,
      expectedGraduationYear: 2029,
      cohort: null,
      phone: null,
      contact: null,
      holds: [
        {
          id: '0196f000-0000-7000-8000-00000000b001',
          type: 'FINANCIAL',
          reason: 'Fees due',
          placedAt: '2026-11-01T00:00:00Z',
          placedBy: null,
          releasedAt: null,
          releasedBy: null,
          releaseNote: null,
        },
      ],
      programHistory: [],
    };
    server.use(
      http.get(`${API}/students/me`, () => HttpResponse.json(envelope(detail))),
      http.patch(`${API}/students/me`, async ({ request }) => {
        patch = await request.json();
        return HttpResponse.json(envelope({ ...detail, phone: '+91 98765 43210' }));
      }),
    );
    const me: MeDto = makeMe({ portals: ['student'], permissions: ['registration:self'] });
    signInAs(me);
    renderRoute('/student/profile');

    expect(await screen.findByText('25CS0001')).toBeInTheDocument();
    expect(screen.getByText(/1 registration hold/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Phone'), '+91 98765 43210');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(patch).toMatchObject({ phone: '+91 98765 43210' }));
  });
});

describe('Department creation gating (TD-010)', () => {
  it('hides "New department" from a department-scoped administrator', async () => {
    server.use(
      ...emptyLists,
      http.get(`${API}/campuses`, () => HttpResponse.json(envelope([]))),
    );
    const me = makeMe({
      portals: ['admin'],
      permissions: ['dashboard:admin', 'department:manage'],
    });
    me.grants['department:manage'] = [{ scope: 'DEPARTMENT', id: cs.id }];
    signInAs(me);
    renderRoute('/admin/departments');
    expect(await screen.findByText(/no departments/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new department/i })).not.toBeInTheDocument();
  });
});
