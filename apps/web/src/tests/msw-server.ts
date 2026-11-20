import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export const API = '*/api/v1';

export const fixtures = {
  university: {
    id: '0196f000-0000-7000-8000-000000000001',
    name: 'Test University',
    shortName: 'TU',
    timezone: 'UTC',
    schoolLabel: 'Faculty',
    website: null,
    contactEmail: null,
  },
  readiness(status: 'ok' | 'degraded' | 'down' = 'ok') {
    return {
      status,
      checks: {
        database: { status: status === 'down' ? 'down' : 'up', latencyMs: 3 },
        redis: { status: 'up', latencyMs: 1 },
        storage: { status: status === 'ok' ? 'up' : 'down', latencyMs: 2 },
      },
      uptimeSeconds: 10,
      version: '0.1.0',
    };
  },
};

export const defaultHandlers = [
  http.get(`${API}/university/public`, () =>
    HttpResponse.json({ success: true, message: 'OK', data: fixtures.university }),
  ),
  http.get(`${API}/health/ready`, () =>
    HttpResponse.json({ success: true, message: 'OK', data: fixtures.readiness('ok') }),
  ),
];

export const envelope = <T>(data: T, message = 'OK') => ({ success: true, message, data });
export const failure = (code: string, message: string, status: number, details?: unknown) =>
  HttpResponse.json(
    { success: false, message, error: { code, details, requestId: 'req-test' } },
    { status },
  );

export const server = setupServer(...defaultHandlers);
