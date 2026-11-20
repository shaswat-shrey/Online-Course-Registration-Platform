import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, server } from '@/tests/msw-server';
import { makeMe, renderRoute, signInAs } from '@/tests/render';

describe('AuditLogPage', () => {
  it('passes URL filters to the API, paginates, and shows change details', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      http.get(`${API}/audit-logs`, ({ request }) => {
        const params = new URL(request.url).searchParams;
        seen.push(params);
        return HttpResponse.json({
          success: true,
          message: 'OK',
          data: [
            {
              id: '1',
              action: 'rbac.role_assigned',
              entityType: 'User',
              entityId: 'abc',
              changes: { role: 'FACULTY' },
              actor: { id: 'u', name: 'Sam Admin', email: 'sam@test.edu' },
              ip: null,
              requestId: null,
              createdAt: '2026-11-20T10:00:00Z',
            },
          ],
          meta: { page: Number(params.get('page')), limit: 25, total: 60, totalPages: 3 },
        });
      }),
    );
    signInAs(makeMe({ portals: ['admin'], permissions: ['dashboard:admin', 'audit:read'] }));
    const { router } = renderRoute('/admin/audit-logs?action=rbac.');

    expect(await screen.findByText('rbac.role_assigned')).toBeInTheDocument();
    expect(seen.at(-1)?.get('action')).toBe('rbac.');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(router.state.location.search).toBe('?action=rbac.&page=2'));
    await waitFor(() => expect(seen.at(-1)?.get('page')).toBe('2'));

    await user.type(screen.getByLabelText('Entity type'), 'Role');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(seen.at(-1)?.get('entityType')).toBe('Role'));
    expect(seen.at(-1)?.get('page')).toBe('1');

    await user.click(screen.getByRole('button', { name: /Details/ }));
    expect(screen.getByText(/"role": "FACULTY"/)).toBeInTheDocument();
  });
});
