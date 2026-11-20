import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, envelope, failure, server } from '@/tests/msw-server';
import { makeMe, renderRoute, signInAs } from '@/tests/render';

const school = {
  id: '0196f000-0000-7000-8000-00000000a001',
  code: 'ENG',
  name: 'Faculty of Engineering',
};
const dept = (id: string, code: string, name: string, canManage: boolean) => ({
  id,
  code,
  name,
  description: null,
  school,
  campus: null,
  contactEmail: null,
  contactPhone: null,
  officeLocation: null,
  status: 'ACTIVE',
  programCount: 1,
  canManage,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});
const page = <T,>(data: T[]) => ({
  success: true,
  message: 'OK',
  data,
  meta: { page: 1, limit: 20, total: data.length, totalPages: 1 },
});

describe('DepartmentsPage', () => {
  it('syncs search and filters to the URL and API, and offers actions only on manageable rows', async () => {
    const calls: URLSearchParams[] = [];
    server.use(
      http.get(`${API}/departments`, ({ request }) => {
        const params = new URL(request.url).searchParams;
        calls.push(params);
        return HttpResponse.json(
          page([
            dept('0196f000-0000-7000-8000-00000000d001', 'CS', 'Computer Science', true),
            dept('0196f000-0000-7000-8000-00000000d002', 'ME', 'Mechanical Engineering', false),
          ]),
        );
      }),
      http.get(`${API}/schools`, () =>
        HttpResponse.json(page([{ ...school, status: 'ACTIVE', departmentCount: 2 }])),
      ),
      http.get(`${API}/campuses`, () => HttpResponse.json(envelope([]))),
    );
    signInAs(makeMe({ portals: ['admin'], permissions: ['dashboard:admin', 'department:manage'] }));
    const { router } = renderRoute('/admin/departments');

    expect(await screen.findByText('Computer Science')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Actions for Computer Science' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Actions for Mechanical Engineering' }),
    ).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Search departments'), 'comp');
    await waitFor(() => expect(router.state.location.search).toBe('?q=comp'));
    await waitFor(() => expect(calls.at(-1)?.get('q')).toBe('comp'));
  });

  it('maps a duplicate-code conflict onto the Code field', async () => {
    server.use(
      http.get(`${API}/departments`, () => HttpResponse.json(page([]))),
      http.get(`${API}/schools`, () =>
        HttpResponse.json(page([{ ...school, status: 'ACTIVE', departmentCount: 0 }])),
      ),
      http.get(`${API}/campuses`, () => HttpResponse.json(envelope([]))),
      http.post(`${API}/departments`, () =>
        failure('UNIQUE_VIOLATION', 'A department with this code already exists', 409, {
          fields: [{ path: 'body.code', message: 'Already in use' }],
        }),
      ),
    );
    signInAs(makeMe({ portals: ['admin'], permissions: ['dashboard:admin', 'department:manage'] }));
    renderRoute(`/admin/departments?schoolId=${school.id}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New department' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Code'), 'cs');
    await user.type(within(dialog).getByLabelText('Name'), 'Computing');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Already in use')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Code')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('ProgramDetailPage', () => {
  it('shows requirement groups with the allocated credit budget', async () => {
    const programId = '0196f000-0000-7000-8000-00000000f001';
    server.use(
      http.get(`${API}/programs/${programId}`, () =>
        HttpResponse.json(
          envelope({
            id: programId,
            code: 'BSC-BIO',
            name: 'B.Sc. in Biology',
            description: null,
            degree: { id: 'd', code: 'BSC', name: 'Bachelor of Science', level: 'UNDERGRADUATE' },
            department: { id: 'dep', code: 'BIO', name: 'Biology', schoolId: 's' },
            durationYears: 3,
            sessionCount: 6,
            totalCredits: 120,
            minCoreCredits: null,
            minElectiveCredits: null,
            status: 'ACTIVE',
            specializationCount: 0,
            canManage: false,
            specializations: [],
            requirementGroups: [
              {
                id: 'g1',
                name: 'Major core',
                description: null,
                kind: 'ALL_OF',
                minCredits: null,
                category: null,
                position: 0,
              },
              {
                id: 'g2',
                name: 'Labs',
                description: null,
                kind: 'CREDITS_FROM_CATEGORY',
                minCredits: 12,
                category: 'LABORATORY',
                position: 1,
              },
            ],
          }),
        ),
      ),
    );
    signInAs(makeMe({ portals: ['admin'], permissions: ['dashboard:admin'] }));
    renderRoute(`/admin/programs/${programId}`);
    expect(await screen.findByRole('heading', { name: 'B.Sc. in Biology' })).toBeInTheDocument();
    expect(screen.getByText(/12 of 120 credits allocated/)).toBeInTheDocument();
    expect(
      screen.getByText('Credits from a category · 12 credits · Laboratory'),
    ).toBeInTheDocument();
    // Read-only users get no edit controls.
    expect(screen.queryByRole('button', { name: 'Add requirement' })).not.toBeInTheDocument();
  });
});
