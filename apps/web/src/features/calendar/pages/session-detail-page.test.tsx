import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, envelope, fixtures, server } from '@/tests/msw-server';
import { makeMe, renderRoute, signInAs } from '@/tests/render';

const SESSION_ID = '0196f000-0000-7000-8000-00000000e001';
const session = {
  id: SESSION_ID,
  code: 'SPRING-2027',
  name: 'Spring 2027',
  type: 'SPRING',
  status: 'PLANNED',
  isCurrent: true,
  startDate: '2027-01-11',
  endDate: '2027-05-21',
  academicYear: { id: 'y', label: '2026-2027' },
  gradingScale: null,
  policy: null,
  registrationPeriod: {
    id: 'p',
    opensAt: '2026-12-01T03:30:00.000Z',
    closesAt: '2027-01-10T18:29:00.000Z',
    lateClosesAt: null,
    addDropDeadline: '2027-01-24T18:29:00.000Z',
    withdrawalDeadline: '2027-04-16T18:29:00.000Z',
    priorityWindows: [],
  },
  registrationState: 'UPCOMING',
};

describe('SessionDetailPage', () => {
  it('edits the registration period in the university time zone and blocks invalid ordering', async () => {
    let saved: Record<string, string> | undefined;
    server.use(
      http.get(`${API}/university/public`, () =>
        HttpResponse.json(envelope({ ...fixtures.university, timezone: 'Asia/Kolkata' })),
      ),
      http.get(`${API}/academic-sessions/${SESSION_ID}`, () =>
        HttpResponse.json(envelope(session)),
      ),
      http.put(
        `${API}/academic-sessions/${SESSION_ID}/registration-period`,
        async ({ request }) => {
          saved = (await request.json()) as Record<string, string>;
          return HttpResponse.json(envelope(session));
        },
      ),
    );
    signInAs(
      makeMe({
        portals: ['admin'],
        permissions: ['dashboard:admin', 'session:manage', 'registration_period:manage'],
      }),
    );
    renderRoute(`/admin/academic-sessions/${SESSION_ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Registration period' }));

    const opens = screen.getByLabelText('Registration opens');
    expect(opens).toHaveValue('2026-12-01T09:00'); // 03:30 UTC shown as 09:00 IST
    const withdrawal = screen.getByLabelText('Withdrawal deadline');
    await user.clear(withdrawal);
    await user.type(withdrawal, '2027-01-20T12:00');
    await user.click(screen.getByRole('button', { name: 'Save registration period' }));
    expect(
      await screen.findByText('Must be on or after the add/drop deadline'),
    ).toBeInTheDocument();
    expect(saved).toBeUndefined();

    await user.clear(withdrawal);
    await user.type(withdrawal, '2027-04-30T17:00');
    await user.click(screen.getByRole('button', { name: 'Save registration period' }));
    await waitFor(() => expect(saved?.withdrawalDeadline).toBe('2027-04-30T11:30:00.000Z'));
    expect(saved?.opensAt).toBe('2026-12-01T03:30:00.000Z');
  });

  it('suggests a policy when none is saved and offers lifecycle actions by status', async () => {
    server.use(
      http.get(`${API}/academic-sessions/${SESSION_ID}`, () =>
        HttpResponse.json(envelope(session)),
      ),
    );
    signInAs(
      makeMe({
        portals: ['admin'],
        permissions: ['dashboard:admin', 'session:manage', 'registration_period:manage'],
      }),
    );
    renderRoute(`/admin/academic-sessions/${SESSION_ID}`);
    expect(await screen.findByRole('button', { name: 'Activate' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make current' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Policy' }));
    expect(screen.getByText(/No policy saved yet/)).toBeInTheDocument();
  });
});
