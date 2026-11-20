import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { useAuthStore } from '@/store/auth-store';
import { API, envelope, failure, server } from '@/tests/msw-server';
import { makeMe, renderRoute } from '@/tests/render';
import { safeNext } from '@/utils/safe-next';

const securityHandlers = [
  http.get(`${API}/auth/sessions`, () => HttpResponse.json(envelope([]))),
  http.get(`${API}/auth/login-history`, () => HttpResponse.json(envelope([]))),
];

async function fill(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('LoginPage', () => {
  it('validates input before calling the API', async () => {
    renderRoute('/login');
    await fill('not-an-email', 'x');
    expect(await screen.findByText(/Invalid email/i)).toBeInTheDocument();
  });

  it('signs in, stores the session in memory and goes to the requested page', async () => {
    let body: unknown;
    server.use(
      ...securityHandlers,
      http.post(`${API}/auth/login`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          envelope({
            accessToken: 'tok',
            accessTokenExpiresAt: '2030-01-01T00:00:00Z',
            me: makeMe({ portals: ['student'] }),
          }),
        );
      }),
    );
    const { router } = renderRoute('/login?next=%2Fstudent%2Faccount');
    await fill('Pat@Test.edu', 'Correct-Horse-1');
    await waitFor(() => expect(router.state.location.pathname).toBe('/student/account'));
    expect(body).toEqual({ email: 'pat@test.edu', password: 'Correct-Horse-1', rememberMe: false });
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', accessToken: 'tok' });
    expect(localStorage.getItem('ucrams-ui') ?? '').not.toContain('tok');
  });

  it.each([
    ['INVALID_CREDENTIALS', 401, undefined, 'The email or password is incorrect.'],
    [
      'ACCOUNT_LOCKED',
      423,
      { retryAfterSeconds: 600 },
      'Your account is locked for about 10 minutes.',
    ],
    ['ACCOUNT_INACTIVE', 403, undefined, 'This account is not active.'],
    ['RATE_LIMITED', 429, undefined, 'Too many attempts.'],
  ])('explains %s', async (code, status, details, text) => {
    server.use(
      http.post(`${API}/auth/login`, () => failure(code, 'server message', status, details)),
    );
    renderRoute('/login');
    await fill('pat@test.edu', 'whatever-password');
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });
});

describe('safeNext', () => {
  it('accepts in-app paths and rejects open redirects', () => {
    expect(safeNext('/admin/roles?x=1')).toBe('/admin/roles?x=1');
    for (const bad of [
      '//evil.example',
      'https://evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '',
      null,
    ]) {
      expect(safeNext(bad)).toBeNull();
    }
  });
});
