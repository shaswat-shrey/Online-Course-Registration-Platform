import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, fixtures, server } from '@/tests/msw-server';
import { renderRoute } from '@/tests/render';

describe('SystemStatusPage', () => {
  it('shows the university and every service check from the API', async () => {
    renderRoute('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Test University' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Operational')).toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(within(list).getByText('Database')).toBeInTheDocument();
    expect(within(list).getByText('Cache & queues')).toBeInTheDocument();
    expect(within(list).getByText('File storage')).toBeInTheDocument();
    expect(within(list).getAllByText('Up')).toHaveLength(3);
  });

  it('renders the down state from a 503 readiness response', async () => {
    server.use(
      http.get(`${API}/health/ready`, () =>
        HttpResponse.json(
          { success: false, message: 'down', data: fixtures.readiness('down') },
          { status: 503 },
        ),
      ),
    );
    renderRoute('/');
    expect(await screen.findByText('Unavailable')).toBeInTheDocument();
    expect(screen.getAllByText('Down').length).toBeGreaterThan(0);
  });

  it('shows an error state with retry when the status cannot be fetched', async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/health/ready`, () => {
        calls += 1;
        if (calls === 1) return HttpResponse.error();
        return HttpResponse.json({
          success: true,
          message: 'OK',
          data: fixtures.readiness('degraded'),
        });
      }),
    );
    renderRoute('/');
    expect(await screen.findByRole('alert')).toHaveTextContent('Status unavailable');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Degraded')).toBeInTheDocument();
  });
});
