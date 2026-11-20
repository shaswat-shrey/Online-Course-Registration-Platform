import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_ROLES, type RoleKey } from '@ucrams/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { closeQueues } from '../../infrastructure/queues/queues.js';
import { resetState } from '../../tests/db.js';
import { bearer, createUser, login, type TestSession } from '../../tests/factories.js';
import { routeManifest } from './define-route.js';

const app = createApp();
const SAMPLE_ID = '00000000-0000-7000-8000-000000000001';
const sessions = new Map<RoleKey | 'NONE', TestSession>();

beforeAll(async () => {
  await resetState();
  sessions.set('NONE', await login(app, (await createUser()).email));
  for (const role of SYSTEM_ROLES)
    sessions.set(role.key, await login(app, (await createUser({ roles: [role.key] })).email));
});
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
});

/**
 * Role → permission matrix (USER_ROLES_AND_PERMISSIONS.md §4) enforced at the
 * route layer: a signed-in user whose roles lack a route's permission gets 403
 * before validation or any service code runs (SECURITY.md §7).
 */
describe('permission matrix', () => {
  const gated = routeManifest.filter(
    (r): r is typeof r & { access: { permission: string } } => 'permission' in r.access,
  );

  it('covers a meaningful number of routes', () => {
    expect(gated.length).toBeGreaterThan(80);
  });

  const cases: Array<[string, string, string, (typeof gated)[number]]> = [];
  for (const who of ['NONE', ...SYSTEM_ROLES.map((r) => r.key)] as const) {
    const held = new Set<string>(
      who === 'NONE' ? [] : SYSTEM_ROLES.find((r) => r.key === who)!.permissions,
    );
    for (const route of gated)
      if (!held.has(route.access.permission))
        cases.push([who, route.method.toUpperCase(), route.fullPath, route]);
  }

  it.each(cases)('%s cannot %s %s', async (who, _m, _p, route) => {
    const path = `/api/v1${route.fullPath.replace(/:[A-Za-z]+/g, SAMPLE_ID)}`;
    const agent = request(app);
    const res = await agent[route.method](path)
      .set(bearer(sessions.get(who as RoleKey | 'NONE')!))
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
