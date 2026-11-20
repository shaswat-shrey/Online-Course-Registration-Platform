import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { closeQueues } from '../../infrastructure/queues/queues.js';
import { resetState } from '../../tests/db.js';
import { routeManifest } from './define-route.js';

const app = createApp();
const SAMPLE_ID = '00000000-0000-7000-8000-000000000001';

beforeAll(resetState);
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
});

/**
 * Default deny (SECURITY.md §7): every route that is not explicitly public must
 * reject anonymous callers with 401 before doing anything else.
 */
describe('default deny', () => {
  const protectedRoutes = routeManifest.filter((r) => !('public' in r.access));

  it('has protected routes to check', () => {
    expect(protectedRoutes.length).toBeGreaterThan(10);
  });

  it.each(protectedRoutes.map((r) => [r.method.toUpperCase(), r.fullPath, r] as const))(
    '%s %s rejects anonymous requests',
    async (_m, _p, route) => {
      const path = `/api/v1${route.fullPath.replace(/:[A-Za-z]+/g, SAMPLE_ID)}`;
      const res = await request(app)[route.method](path).send({});
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    },
  );

  it('every permission-protected route declares a known permission', async () => {
    const { isPermissionKey } = await import('@ucrams/shared');
    for (const r of routeManifest) {
      if ('permission' in r.access)
        expect(isPermissionKey(r.access.permission), r.fullPath).toBe(true);
    }
  });
});
