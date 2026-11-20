import { http as mswHttp, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, server } from '@/tests/msw-server';
import { ApiError, errorMessage, NETWORK_ERROR } from './api-error';
import { apiGet } from './http';

describe('http client', () => {
  it('unwraps the success envelope', async () => {
    server.use(
      mswHttp.get(`${API}/thing`, () =>
        HttpResponse.json({ success: true, message: 'OK', data: { a: 1 } }),
      ),
    );
    await expect(apiGet('/thing')).resolves.toEqual({ a: 1 });
  });

  it('converts error envelopes into ApiError with code, details and request id', async () => {
    server.use(
      mswHttp.get(`${API}/thing`, () =>
        HttpResponse.json(
          {
            success: false,
            message: 'Credit limit exceeded',
            error: { code: 'CREDIT_LIMIT_EXCEEDED', details: { max: 24 }, requestId: 'req-1' },
          },
          { status: 422 },
        ),
      ),
    );
    const error = await apiGet('/thing').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      code: 'CREDIT_LIMIT_EXCEEDED',
      details: { max: 24 },
      requestId: 'req-1',
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
    expect(errorMessage(error)).toMatch(/Unable to reach the server/);
  });
});
