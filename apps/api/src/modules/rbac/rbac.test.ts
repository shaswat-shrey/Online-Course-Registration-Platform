import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { RoleKey } from '@ucrams/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { closeQueues } from '../../infrastructure/queues/queues.js';
import { resetState } from '../../tests/db.js';
import { bearer, createUser, login, type TestSession } from '../../tests/factories.js';

const app = createApp();
const api = '/api/v1';

beforeEach(resetState);
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
});

async function as(role: RoleKey): Promise<TestSession & { userId: string }> {
  const user = await createUser({ roles: [role] });
  return { ...(await login(app, user.email)), userId: user.id };
}
const roleId = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key } })).id;

describe('RBAC read access matrix', () => {
  const cases: Array<[RoleKey, number]> = [
    ['SUPER_ADMIN', 200],
    ['UNIVERSITY_ADMIN', 200],
    ['ACADEMIC_ADMIN', 403],
    ['DEPARTMENT_ADMIN', 403],
    ['FACULTY', 403],
    ['STUDENT', 403],
  ];
  it.each(cases)('%s → GET /roles is %i', async (role, status) => {
    const s = await as(role);
    await request(app).get(`${api}/roles`).set(bearer(s)).expect(status);
    await request(app).get(`${api}/permissions`).set(bearer(s)).expect(status);
  });

  it('lists the seeded system roles with permission counts', async () => {
    const s = await as('SUPER_ADMIN');
    const res = await request(app).get(`${api}/roles`).set(bearer(s)).expect(200);
    const byKey = Object.fromEntries(res.body.data.map((r: { key: string }) => [r.key, r]));
    expect(Object.keys(byKey).sort()).toEqual(
      [
        'ACADEMIC_ADMIN',
        'DEPARTMENT_ADMIN',
        'FACULTY',
        'STUDENT',
        'SUPER_ADMIN',
        'UNIVERSITY_ADMIN',
      ].sort(),
    );
    expect(byKey.SUPER_ADMIN.assignmentCount).toBe(1);
    expect(byKey.STUDENT.permissions).toContain('registration:self');
  });
});

describe('role management', () => {
  it('only the super admin can change role permissions; holders must refresh', async () => {
    const sa = await as('SUPER_ADMIN');
    const ua = await as('UNIVERSITY_ADMIN');
    const student = await as('STUDENT');
    const studentRole = await roleId('STUDENT');
    const current = (await request(app).get(`${api}/roles/${studentRole}`).set(bearer(sa))).body
      .data.permissions as string[];

    await request(app)
      .put(`${api}/roles/${studentRole}/permissions`)
      .set(bearer(ua))
      .send({ permissions: current })
      .expect(403);

    const res = await request(app)
      .put(`${api}/roles/${studentRole}/permissions`)
      .set(bearer(sa))
      .send({ permissions: current.filter((p) => p !== 'feedback:submit') })
      .expect(200);
    expect(res.body.data.permissions).not.toContain('feedback:submit');

    // The student's existing token is now stale.
    const stale = await request(app).get(`${api}/auth/me`).set(bearer(student)).expect(401);
    expect(stale.body.error.code).toBe('TOKEN_EXPIRED');

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'rbac.role_permissions_changed' },
    });
    expect(audit.changes).toEqual({ added: [], removed: ['feedback:submit'] });
  });

  it('protects the super admin role and system roles', async () => {
    const sa = await as('SUPER_ADMIN');
    const superRole = await roleId('SUPER_ADMIN');
    await request(app)
      .put(`${api}/roles/${superRole}/permissions`)
      .set(bearer(sa))
      .send({ permissions: [] })
      .expect(422);
    await request(app)
      .delete(`${api}/roles/${await roleId('FACULTY')}`)
      .set(bearer(sa))
      .expect(422);
  });

  it('creates, renames and deletes a custom role', async () => {
    const sa = await as('SUPER_ADMIN');
    const created = await request(app)
      .post(`${api}/roles`)
      .set(bearer(sa))
      .send({
        key: 'TIMETABLE_OFFICER',
        name: 'Timetable Officer',
        permissions: ['classroom:manage', 'section:update'],
      })
      .expect(201);
    expect(created.body.data).toMatchObject({
      isSystem: false,
      permissions: ['classroom:manage', 'section:update'],
    });

    await request(app)
      .post(`${api}/roles`)
      .set(bearer(sa))
      .send({ key: 'TIMETABLE_OFFICER', name: 'Duplicate', permissions: [] })
      .expect(409);
    await request(app)
      .post(`${api}/roles`)
      .set(bearer(sa))
      .send({ key: 'bad key', name: 'X', permissions: ['not:real'] })
      .expect(400);

    const id = created.body.data.id;
    await request(app)
      .patch(`${api}/roles/${id}`)
      .set(bearer(sa))
      .send({ name: 'Scheduling Officer' })
      .expect(200);
    await request(app).delete(`${api}/roles/${id}`).set(bearer(sa)).expect(200);
    expect(await prisma.role.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: id } })).toBe(3);
  });

  it('refuses to delete a custom role that is still assigned', async () => {
    const sa = await as('SUPER_ADMIN');
    const role = await prisma.role.create({ data: { key: 'TEMP_ROLE', name: 'Temp' } });
    const user = await createUser();
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    const res = await request(app).delete(`${api}/roles/${role.id}`).set(bearer(sa)).expect(422);
    expect(res.body.error.details).toEqual({ assignmentCount: 1 });
  });
});

describe('role assignment', () => {
  it('lets an admin assign a role they fully hold, and the user gains access after refresh', async () => {
    const ua = await as('UNIVERSITY_ADMIN');
    const target = await createUser();
    await request(app)
      .post(`${api}/users/${target.id}/roles`)
      .set(bearer(ua))
      .send({ roleId: await roleId('FACULTY'), scopeType: 'GLOBAL' })
      .expect(201);
    const roles = await request(app)
      .get(`${api}/users/${target.id}/roles`)
      .set(bearer(ua))
      .expect(200);
    expect(roles.body.data.map((r: { roleKey: string }) => r.roleKey)).toEqual(['FACULTY']);

    const s = await login(app, target.email);
    const me = await request(app).get(`${api}/auth/me`).set(bearer(s)).expect(200);
    expect(me.body.data.portals).toEqual(['faculty']);

    // Duplicate assignment
    await request(app)
      .post(`${api}/users/${target.id}/roles`)
      .set(bearer(ua))
      .send({ roleId: await roleId('FACULTY'), scopeType: 'GLOBAL' })
      .expect(409);
  });

  it('blocks privilege escalation: a university admin cannot grant super admin', async () => {
    const ua = await as('UNIVERSITY_ADMIN');
    const target = await createUser();
    const res = await request(app)
      .post(`${api}/users/${target.id}/roles`)
      .set(bearer(ua))
      .send({ roleId: await roleId('SUPER_ADMIN'), scopeType: 'GLOBAL' })
      .expect(403);
    expect(res.body.message).toMatch(/do not hold/);
    // Nor to themselves
    await request(app)
      .post(`${api}/users/${ua.userId}/roles`)
      .set(bearer(ua))
      .send({ roleId: await roleId('SUPER_ADMIN'), scopeType: 'GLOBAL' })
      .expect(403);
  });

  it('relationship roles cannot be given an organisational scope', async () => {
    const sa = await as('SUPER_ADMIN');
    const target = await createUser();
    const res = await request(app)
      .post(`${api}/users/${target.id}/roles`)
      .set(bearer(sa))
      .send({
        roleId: await roleId('FACULTY'),
        scopeType: 'DEPARTMENT',
        scopeId: '00000000-0000-7000-8000-000000000001',
      })
      .expect(422);
    expect(res.body.message).toMatch(/own sections and records/);
  });

  it('faculty grants are OWN-scoped and never satisfy organisational checks', async () => {
    const faculty = await createUser({ roles: ['FACULTY'] });
    const { getAuthState } = await import('../authz/grants.service.js');
    const state = await getAuthState(faculty.id);
    expect(state!.grants['material:manage']).toEqual([{ scope: 'OWN' }]);
    expect(state!.grants['roster:read']).toEqual([{ scope: 'OWN' }]);
  });

  it('faculty and students cannot assign roles at all', async () => {
    const target = await createUser();
    for (const role of ['FACULTY', 'STUDENT'] as const) {
      const s = await as(role);
      await request(app)
        .post(`${api}/users/${target.id}/roles`)
        .set(bearer(s))
        .send({ roleId: await roleId('STUDENT'), scopeType: 'GLOBAL' })
        .expect(403);
    }
  });

  it('rejects scoped assignments to unknown schools or departments', async () => {
    const sa = await as('SUPER_ADMIN');
    const target = await createUser();
    const res = await request(app)
      .post(`${api}/users/${target.id}/roles`)
      .set(bearer(sa))
      .send({
        roleId: await roleId('DEPARTMENT_ADMIN'),
        scopeType: 'DEPARTMENT',
        scopeId: '00000000-0000-7000-8000-000000000001',
      })
      .expect(422);
    expect(res.body.message).toBe('Unknown department');
    await request(app)
      .post(`${api}/users/${target.id}/roles`)
      .set(bearer(sa))
      .send({ roleId: await roleId('DEPARTMENT_ADMIN'), scopeType: 'DEPARTMENT' })
      .expect(400);
  });

  it('keeps at least one super admin', async () => {
    const sa = await as('SUPER_ADMIN');
    const assignment = await prisma.userRole.findFirstOrThrow({ where: { userId: sa.userId } });
    const res = await request(app)
      .delete(`${api}/users/${sa.userId}/roles/${assignment.id}`)
      .set(bearer(sa))
      .expect(422);
    expect(res.body.message).toMatch(/At least one Super Administrator/);

    const second = await as('SUPER_ADMIN');
    await request(app)
      .delete(`${api}/users/${sa.userId}/roles/${assignment.id}`)
      .set(bearer(second))
      .expect(200);
    // The demoted admin's token is stale; after refresh they no longer have access.
    await request(app).get(`${api}/roles`).set(bearer(sa)).expect(401);
  });
});

describe('administrative account security', () => {
  it('admins can view and revoke sessions, view login history and unlock accounts', async () => {
    const ua = await as('UNIVERSITY_ADMIN');
    const target = await createUser();
    const s = await login(app, target.email);

    const sessions = await request(app)
      .get(`${api}/users/${target.id}/sessions`)
      .set(bearer(ua))
      .expect(200);
    expect(sessions.body.data).toHaveLength(1);
    const history = await request(app)
      .get(`${api}/users/${target.id}/login-history`)
      .set(bearer(ua))
      .expect(200);
    expect(history.body.data[0].outcome).toBe('SUCCESS');

    const revoked = await request(app)
      .delete(`${api}/users/${target.id}/sessions`)
      .set(bearer(ua))
      .expect(200);
    expect(revoked.body.data.sessionsRevoked).toBe(1);
    await request(app).get(`${api}/auth/me`).set(bearer(s)).expect(401);

    await prisma.user.update({
      where: { id: target.id },
      data: { lockedUntil: new Date(Date.now() + 3600_000), lockoutCount: 2 },
    });
    await request(app).post(`${api}/users/${target.id}/unlock`).set(bearer(ua)).expect(200);
    await login(app, target.email);
  });

  it('is unavailable to faculty and students', async () => {
    const target = await createUser();
    const f = await as('FACULTY');
    await request(app).get(`${api}/users/${target.id}/sessions`).set(bearer(f)).expect(403);
    await request(app).post(`${api}/users/${target.id}/unlock`).set(bearer(f)).expect(403);
  });

  it('returns 404 for unknown users', async () => {
    const ua = await as('UNIVERSITY_ADMIN');
    await request(app)
      .get(`${api}/users/00000000-0000-7000-8000-000000000099/sessions`)
      .set(bearer(ua))
      .expect(404);
  });
});
