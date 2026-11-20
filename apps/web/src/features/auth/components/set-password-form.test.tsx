import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, envelope, failure, server } from '@/tests/msw-server';
import { renderRoute } from '@/tests/render';

const TOKEN = 't'.repeat(43);

async function submit(password: string, confirm = password) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('New password'), password);
  await user.type(screen.getByLabelText('Confirm password'), confirm);
  await user.click(screen.getByRole('button', { name: /Reset password|Activate account/ }));
}

describe('password reset and invitation', () => {
  it('explains a missing token', async () => {
    renderRoute('/reset-password');
    expect(await screen.findByRole('heading', { name: 'Link not valid' })).toBeInTheDocument();
  });

  it('checks the confirmation and the minimum length locally', async () => {
    renderRoute(`/reset-password?token=${TOKEN}`);
    await submit('short', 'short');
    expect(await screen.findByText(/at least 10 characters/)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('New password'));
    await userEvent.clear(screen.getByLabelText('Confirm password'));
    await submit('Long-enough-pass-1', 'Different-pass-22');
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
  });

  it('resets and offers sign-in on success', async () => {
    let body: unknown;
    server.use(
      http.post(`${API}/auth/reset-password`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(envelope(null));
      }),
    );
    renderRoute(`/reset-password?token=${TOKEN}`);
    await submit('Long-enough-pass-1');
    expect(await screen.findByRole('heading', { name: 'Password reset' })).toBeInTheDocument();
    expect(body).toEqual({ token: TOKEN, password: 'Long-enough-pass-1' });
  });

  it('shows server policy errors on the field and expired links as an alert', async () => {
    server.use(
      http.post(`${API}/auth/accept-invite`, () =>
        failure('VALIDATION_ERROR', 'This password is too common', 422),
      ),
    );
    renderRoute(`/accept-invite?token=${TOKEN}`);
    await submit('password1234');
    expect(await screen.findByText('This password is too common')).toBeInTheDocument();

    server.use(
      http.post(`${API}/auth/accept-invite`, () =>
        failure('VALIDATION_ERROR', 'This link is invalid or has expired. Request a new one.', 422),
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Activate account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
    expect(screen.getByRole('link', { name: 'Request a new link' })).toBeInTheDocument();
  });
});
