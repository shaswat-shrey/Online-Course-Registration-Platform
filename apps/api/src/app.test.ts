import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { AppError } from './common/exceptions/app-error.js';
import { errorHandler } from './common/middleware/error-handler.js';
import { rateLimit } from './common/middleware/rate-limit.js';
import { requestId } from './common/middleware/request-id.js';
import { routeManifest } from './common/http/define-route.js';
import { prisma } from './infrastructure/database/prisma.js';
import { redis } from './infrastructure/redis/redis.js';
import { generateOpenApiDocument } from './openapi/registry.js';
import { resetDatabase } from './tests/db.js';

const app = createApp();

afterAll(async () => {
  await prisma.$disconnect();
});

describe('health', () => {
  it('reports liveness', async () => {
    const res = await request(app).get('/api/v1/health/live').expect(200);
    expect(res.body).toMatchObject({ success: true, data: { status: 'ok' } });
  });

  it('reports readiness with database, redis and storage checks', async () => {
    const res = await request(app).get('/api/v1/health/ready').expect(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.checks.database.status).toBe('up');
    expect(res.body.data.checks.redis.status).toBe('up');
    expect(res.body.data.checks.storage.status).toBe('up');
  });
});

describe('university (database-backed)', () => {
  beforeEach(resetDatabase);

  it('returns 404 in the error envelope when no university exists', async () => {
    const res = await request(app).get('/api/v1/university/public').expect(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('returns only public fields from the database', async () => {
    await prisma.university.create({
      data: {
        name: 'Test University',
        shortName: 'TU',
        address: '1 Private Lane',
        contactPhone: '123',
      },
    });
    const res = await request(app).get('/api/v1/university/public').expect(200);
    expect(res.body).toMatchObject({
      success: true,
      message: 'University retrieved successfully',
      data: { name: 'Test University', shortName: 'TU', timezone: 'UTC', schoolLabel: 'Faculty' },
    });
    expect(res.body.data).not.toHaveProperty('address');
    expect(res.body.data).not.toHaveProperty('contactPhone');
  });
});

describe('cross-cutting HTTP behaviour', () => {
  it('returns NOT_FOUND envelope with a request id for unknown routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('reuses a well-formed incoming request id and replaces a malformed one', async () => {
    const good = await request(app)
      .get('/api/v1/health/live')
      .set('X-Request-Id', 'proxy-abc-12345');
    expect(good.headers['x-request-id']).toBe('proxy-abc-12345');
    const bad = await request(app)
      .get('/api/v1/health/live')
      .set('X-Request-Id', 'bad id <script>alert(1)</script>');
    expect(bad.headers['x-request-id']).not.toContain('script');
  });

  it('rejects malformed JSON with VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/v1/university/public')
      .set('Content-Type', 'application/json')
      .send('{bad')
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects bodies over 1mb with PAYLOAD_TOO_LARGE', async () => {
    const res = await request(app)
      .post('/api/v1/university/public')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(1_100_000) }))
      .expect(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/api/v1/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows configured CORS origins only', async () => {
    const allowed = await request(app)
      .get('/api/v1/health/live')
      .set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    const denied = await request(app)
      .get('/api/v1/health/live')
      .set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves the OpenAPI document', async () => {
    const res = await request(app).get('/api/docs/openapi.json').expect(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.paths['/health/ready']).toBeDefined();
  });
});

describe('error handler', () => {
  const testApp = express();
  testApp.use(requestId);
  testApp.get('/boom', () => {
    throw new Error('SELECT * FROM secret_table -- internal detail');
  });
  testApp.get('/rule', () => {
    throw new AppError(422, 'CREDIT_LIMIT_EXCEEDED', 'Credit limit exceeded', {
      details: { max: 24 },
    });
  });
  testApp.use(errorHandler);

  it('hides internal error messages behind INTERNAL_ERROR', async () => {
    const res = await request(testApp).get('/boom').expect(500);
    expect(res.body).toMatchObject({ success: false, error: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(res.body)).not.toContain('secret_table');
    expect(JSON.stringify(res.body)).not.toContain('stack');
  });

  it('passes through AppError code, message and details', async () => {
    const res = await request(testApp).get('/rule').expect(422);
    expect(res.body).toMatchObject({
      message: 'Credit limit exceeded',
      error: { code: 'CREDIT_LIMIT_EXCEEDED', details: { max: 24 } },
    });
  });
});

describe('rate limiting', () => {
  it('returns 429 with Retry-After once the limit is exhausted', async () => {
    await redis.del('rl:test-limit:1.2.3.4');
    const limited = express();
    limited.use(
      rateLimit({ name: 'test-limit', points: 2, durationSeconds: 60, key: () => '1.2.3.4' }),
    );
    limited.get('/', (_req, res) => {
      res.json({ ok: true });
    });
    limited.use(errorHandler);

    await request(limited).get('/').expect(200);
    const second = await request(limited).get('/').expect(200);
    expect(second.headers['ratelimit-remaining']).toBe('0');
    const third = await request(limited).get('/').expect(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('route manifest', () => {
  it('every route declares access and every visible route is documented', () => {
    const document = generateOpenApiDocument();
    expect(routeManifest.length).toBeGreaterThan(0);
    for (const route of routeManifest) {
      expect(route.access, `${route.method} ${route.fullPath}`).toBeDefined();
      if (route.hidden) continue;
      const docPath = route.fullPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      expect(
        document.paths?.[docPath]?.[route.method],
        `${route.method} ${docPath} undocumented`,
      ).toBeDefined();
    }
  });
});
