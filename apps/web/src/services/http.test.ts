import { http as mswHttp, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { useAuthStore } from '@/store/auth-store';
import { API, envelope, failure, server } from '@/tests/msw-server';
import { makeMe, signInAs } from '@/tests/render';
import { ApiError, errorMessage, NETWORK_ERROR } from './api-error';
import { apiGet } from './http';

describe('http client', () => {
  it('unwraps the success envelope and sends the bearer token', async () => {
    signInAs(makeMe(), 'token-1');
    let auth: string | null = null;
    server.use(
      mswHttp.get(`${API}/thing`, ({ request }) => {
        auth = request.headers.get('authorization');
        return HttpResponse.json(envelope({ a: 1 }));
      }),
    );
    await expect(apiGet('/thing')).resolves.toEqual({ a: 1 });
    expect(auth).toBe('Bearer token-1');
  });

  it('converts error envelopes into ApiError with code, details and request id', async () => {
    server.use(
      mswHttp.get(`${API}/thing`, () =>
        failure('CREDIT_LIMIT_EXCEEDED', 'Credit limit exceeded', 422, { max: 24 }),
      ),
    );
    const error = await apiGet('/thing').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      code: 'CREDIT_LIMIT_EXCEEDED',
      details: { max: 24 },
      requestId: 'req-test',
    });
    expect(errorMessage(error)).toBe('Credit limit exceeded');
  });

  it('reports non-envelope failures and network errors distinctly', async () => {
    server.use(
      mswHttp.get(
        `${API}/html`,
        () => new HttpResponse('<html>bad gateway</html>', { status: 502 }),
      ),
    );
    await expect(apiGet('/html')).rejects.toMatchObject({ status: 502, code: 'HTTP_ERROR' });
    server.use(mswHttp.get(`${API}/down`, () => HttpResponse.error()));
    const error = await apiGet('/down').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: NETWORK_ERROR });
  });

  it('refreshes once for concurrent expired-token failures and retries each request', async () => {
    signInAs(makeMe(), 'old-token');
    document.cookie = 'ucrams_csrf=csrf-value; path=/';
    let refreshCalls = 0;
    let csrfHeader: string | null = null;
    server.use(
      mswHttp.post(`${API}/auth/refresh`, ({ request }) => {
        refreshCalls += 1;
        csrfHeader = request.headers.get('x-csrf-token');
        return HttpResponse.json(
          envelope({ accessToken: 'new-token', accessTokenExpiresAt: '2030-01-01T00:00:00Z' }),
        );
      }),
      mswHttp.get(`${API}/data/:n`, ({ request, params }) =>
        request.headers.get('authorization') === 'Bearer new-token'
          ? HttpResponse.json(envelope({ n: params.n }))
          : failure('TOKEN_EXPIRED', 'Access token expired', 401),
      ),
    );
    const results = await Promise.all([apiGet('/data/1'), apiGet('/data/2'), apiGet('/data/3')]);
    expect(results).toEqual([{ n: '1' }, { n: '2' }, { n: '3' }]);
    expect(refreshCalls).toBe(1);
    expect(csrfHeader).toBe('csrf-value');
    expect(useAuthStore.getState().accessToken).toBe('new-token');
  });

  it('ends the session when the refresh fails', async () => {
    signInAs(makeMe(), 'old-token');
    server.use(
      mswHttp.post(`${API}/auth/refresh`, () => failure('SESSION_REVOKED', 'Session ended', 401)),
      mswHttp.get(`${API}/data`, () => failure('TOKEN_EXPIRED', 'Access token expired', 401)),
    );
    await expect(apiGet('/data')).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    expect(useAuthStore.getState()).toMatchObject({
      status: 'anonymous',
      endReason: 'expired',
      accessToken: null,
    });
  });

  it('ends the session immediately on SESSION_REVOKED', async () => {
    signInAs(makeMe());
    server.use(mswHttp.get(`${API}/data`, () => failure('SESSION_REVOKED', 'Session ended', 401)));
    await expect(apiGet('/data')).rejects.toBeInstanceOf(ApiError);
    expect(useAuthStore.getState().status).toBe('anonymous');
  });
});
