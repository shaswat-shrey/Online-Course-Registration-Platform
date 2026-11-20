import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { closeQueues } from '../../infrastructure/queues/queues.js';
import { resetState } from '../../tests/db.js';
import { bearer, createUser, login } from '../../tests/factories.js';
import { diffChanges } from './audit.service.js';

const app = createApp();
beforeEach(resetState);
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
});

describe('diffChanges', () => {
  it('keeps changed fields only and redacts sensitive ones', () => {
    expect(
      diffChanges(
        { name: 'A', code: 'X', passwordHash: 'h1' },
        { name: 'B', code: 'X', passwordHash: 'h2' },
      ),
    ).toEqual({
      name: { from: 'A', to: 'B' },
      passwordHash: { from: '[REDACTED]', to: '[REDACTED]' },
    });
  });
});

describe('GET /audit-logs', () => {
  it('filters by action prefix and actor, newest first, with pagination', async () => {
    const admin = await createUser({ roles: ['UNIVERSITY_ADMIN'] });
    const s = await login(app, admin.email);
    await request(app).post('/api/v1/auth/logout-all').set(bearer(s));
    await prisma.auditLog.createMany({
      data: [
        { action: 'rbac.role_created', entityType: 'Role', entityId: 'r1', actorId: admin.id },
        { action: 'rbac.role_deleted', entityType: 'Role', entityId: 'r1', actorId: admin.id },
        { action: 'other.thing', entityType: 'Thing' },
      ],
    });
    const s2 = await login(app, admin.email);

    const res = await request(app)
      .get('/api/v1/audit-logs?action=rbac.&limit=1')
      .set(bearer(s2))
      .expect(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
    expect(res.body.data[0]).toMatchObject({
      action: 'rbac.role_deleted',
      actor: { id: admin.id, email: admin.email },
    });

    const byActor = await request(app)
      .get(`/api/v1/audit-logs?actorId=${admin.id}`)
      .set(bearer(s2))
      .expect(200);
    expect(byActor.body.data.map((e: { action: string }) => e.action)).toEqual([
      'rbac.role_deleted',
      'rbac.role_created',
      'auth.logout_all',
    ]);
    await request(app).get('/api/v1/audit-logs?from=yesterday').set(bearer(s2)).expect(400);
  });

  it('is denied to faculty and students', async () => {
    const faculty = await createUser({ roles: ['FACULTY'] });
    await request(app)
      .get('/api/v1/audit-logs')
      .set(bearer(await login(app, faculty.email)))
      .expect(403);
  });
});
