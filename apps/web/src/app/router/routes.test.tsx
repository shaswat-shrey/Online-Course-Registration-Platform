import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, envelope, server } from '@/tests/msw-server';
import { makeMe, renderRoute, signInAs, signOutStore } from '@/tests/render';

const emptySecurity = [
  http.get(`${API}/auth/sessions`, () => HttpResponse.json(envelope([]))),
  http.get(`${API}/auth/login-history`, () => HttpResponse.json(envelope([]))),
];

describe('routing and guards', () => {
  it('renders the 404 page for unknown paths', async () => {
    renderRoute('/no/such/page');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('sends anonymous visitors of protected pages to login, remembering the destination', async () => {
    signOutStore();
    const { router } = renderRoute('/admin/roles');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?next=%2Fadmin%2Froles');
  });

  it('explains an expired session and omits next after an explicit sign-out', async () => {
    signOutStore('expired');
    const expired = renderRoute('/student/dashboard');
    expect(
      await screen.findByText('Your session ended. Please sign in again.'),
    ).toBeInTheDocument();
    expired.unmount();

    signOutStore('signed-out');
    const { router } = renderRoute('/admin/dashboard');
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(router.state.location.search).toBe('');
  });

  it('redirects users away from portals they cannot access', async () => {
    server.use(...emptySecurity);
    signInAs(makeMe({ portals: ['student'] }));
    const { router } = renderRoute('/admin/roles');
    await waitFor(() => expect(router.state.location.pathname).toBe('/student/dashboard'));
    expect(await screen.findByText(/Good (morning|afternoon|evening), Pat/)).toBeInTheDocument();
  });

  it('shows 403 for admin pages that need a missing permission, and hides their navigation', async () => {
    server.use(...emptySecurity);
    signInAs(makeMe({ portals: ['admin'], permissions: ['dashboard:admin'] }));
    const { router } = renderRoute('/admin/roles');
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/403');

    await router.navigate('/admin/dashboard');
    await screen.findByText(/Good (morning|afternoon|evening), Pat/);
    expect(screen.queryByRole('link', { name: /Roles & permissions/ })).not.toBeInTheDocument();
  });

  it('sends signed-in users from / and /login to their portal', async () => {
    server.use(...emptySecurity);
    signInAs(makeMe({ portals: ['faculty'] }));
    const { router } = renderRoute('/login');
    await waitFor(() => expect(router.state.location.pathname).toBe('/faculty/dashboard'));
  });

  it('sends signed-in users without any portal to the no-access page', async () => {
    signInAs(makeMe({ portals: [] }));
    renderRoute('/');
    expect(
      await screen.findByRole('heading', { name: 'No portal access yet' }),
    ).toBeInTheDocument();
  });
});
