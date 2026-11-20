import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, envelope, server } from '@/tests/msw-server';
import { makeMe, renderRoute, signInAs } from '@/tests/render';

const ROLE_ID = '0196f000-0000-7000-8000-0000000000dd';
const role = (permissions: string[], key = 'STUDENT') => ({
  id: ROLE_ID,
  key,
  name: key === 'STUDENT' ? 'Student' : 'Super Administrator',
  description: null,
  isSystem: true,
  scopeMode: key === 'STUDENT' ? 'RELATIONSHIP' : 'ORGANIZATIONAL',
  permissions,
  assignmentCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});
const permissions = [
  {
    key: 'ticket:submit',
    resource: 'ticket',
    action: 'submit',
    description: 'Create support tickets',
  },
  { key: 'ticket:manage', resource: 'ticket', action: 'manage', description: 'Manage tickets' },
];

describe('RoleDetailPage', () => {
  it('lets a super admin change permissions after confirming', async () => {
    let saved: unknown;
    server.use(
      http.get(`${API}/roles/${ROLE_ID}`, () =>
        HttpResponse.json(envelope(role(['ticket:submit']))),
      ),
      http.get(`${API}/permissions`, () => HttpResponse.json(envelope(permissions))),
      http.get(`${API}/roles`, () => HttpResponse.json(envelope([]))),
      http.put(`${API}/roles/${ROLE_ID}/permissions`, async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json(envelope(role([])));
      }),
    );
    signInAs(
      makeMe({ portals: ['admin'], permissions: ['dashboard:admin', 'rbac:read', 'rbac:manage'] }),
    );
    renderRoute(`/admin/roles/${ROLE_ID}`);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: /ticket:submit/ }));
    expect(screen.getByText(/added,/)).toHaveTextContent('0 added, 1 removed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saved).toEqual({ permissions: [] }));
  });

  it('is read-only without rbac:manage and for the super admin role', async () => {
    server.use(
      http.get(`${API}/roles/${ROLE_ID}`, () =>
        HttpResponse.json(envelope(role(['ticket:submit'], 'SUPER_ADMIN'))),
      ),
      http.get(`${API}/permissions`, () => HttpResponse.json(envelope(permissions))),
    );
    signInAs(
      makeMe({ portals: ['admin'], permissions: ['dashboard:admin', 'rbac:read', 'rbac:manage'] }),
    );
    renderRoute(`/admin/roles/${ROLE_ID}`);
    expect(await screen.findByText(/cannot be edited/)).toBeInTheDocument();
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
  });
});
