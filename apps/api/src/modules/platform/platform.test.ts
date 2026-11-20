import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { closeQueues } from '../../infrastructure/queues/queues.js';
import { resetState } from '../../tests/db.js';
import {
  bearer,
  createCourse,
  createDepartment,
  createFacultyRecord,
  createProgram,
  createStudentRecord,
  createUser,
  grantScoped,
  login,
} from '../../tests/factories.js';
import { clearSettingsCache } from './settings.service.js';

const app = createApp();
const api = '/api/v1';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

beforeEach(async () => {
  await resetState();
  clearSettingsCache();
});
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
});

async function uploadDocument(auth: { accessToken: string }) {
  const intent = await request(app).post(`${api}/files/upload-intents`).set(bearer(auth)).send({
    context: 'DOCUMENT',
    fileName: 'policy.pdf',
    mimeType: 'application/pdf',
    sizeBytes: PDF.length,
  });
  if (intent.status !== 201) return { status: intent.status, fileId: '' };
  await request(app)
    .put(new URL(intent.body.data.upload.url).pathname)
    .set('Content-Type', 'application/pdf')
    .send(PDF)
    .expect(204);
  await request(app)
    .post(`${api}/files/${intent.body.data.fileId}/complete`)
    .set(bearer(auth))
    .expect(200);
  return { status: 201, fileId: intent.body.data.fileId as string };
}

describe('system settings', () => {
  it('are validated, audited and change behaviour; only the public ones are readable by all', async () => {
    const admin = await login(app, (await createUser({ roles: ['SUPER_ADMIN'] })).email);
    const student = await login(app, (await createUser({ roles: ['STUDENT'] })).email);
    await request(app).get(`${api}/settings`).set(bearer(student)).expect(403);
    const list = await request(app).get(`${api}/settings`).set(bearer(admin)).expect(200);
    expect(list.body.data.map((s: { key: string }) => s.key)).toContain(
      'notifications.retentionDays',
    );

    await request(app)
      .patch(`${api}/settings/notifications.retentionDays`)
      .set(bearer(admin))
      .send({ value: 5 })
      .expect(422);
    await request(app)
      .patch(`${api}/settings/nope`)
      .set(bearer(admin))
      .send({ value: 1 })
      .expect(404);
    await request(app)
      .patch(`${api}/settings/portal.bannerMessage`)
      .set(bearer(admin))
      .send({ value: 'Maintenance on Saturday' })
      .expect(200);
    const pub = await request(app).get(`${api}/settings/public`).set(bearer(student)).expect(200);
    expect(pub.body.data).toEqual({ 'portal.bannerMessage': 'Maintenance on Saturday' });
    expect(await prisma.auditLog.count({ where: { action: 'settings.updated' } })).toBe(1);
  });
});

describe('global search', () => {
  it('finds catalog entries for everyone and students only within scope', async () => {
    const dept = await createDepartment();
    const other = await createDepartment();
    const program = await createProgram(dept.id);
    const course = await createCourse(dept.id);
    await prisma.course.update({
      where: { id: course.id },
      data: { title: 'Quantum Zebra Mechanics' },
    });
    const { student } = await createStudentRecord(program.id);
    const stu = await prisma.student.findUniqueOrThrow({
      where: { id: student.id },
      include: { user: true },
    });

    const viewer = await login(app, (await createUser({ roles: ['STUDENT'] })).email);
    const found = await request(app)
      .get(`${api}/search`)
      .query({ q: 'zebra' })
      .set(bearer(viewer))
      .expect(200);
    expect(found.body.data.groups[0]).toMatchObject({ type: 'course' });
    const hidden = await request(app)
      .get(`${api}/search`)
      .query({ q: stu.studentNumber })
      .set(bearer(viewer))
      .expect(200);
    expect(hidden.body.data.total).toBe(0);

    const inScope = await createUser({ roles: [] });
    await grantScoped(inScope.id, 'DEPARTMENT_ADMIN', {
      scopeType: 'DEPARTMENT',
      scopeId: dept.id,
    });
    const outScope = await createUser({ roles: [] });
    await grantScoped(outScope.id, 'DEPARTMENT_ADMIN', {
      scopeType: 'DEPARTMENT',
      scopeId: other.id,
    });
    const a = await login(app, inScope.email);
    const b = await login(app, outScope.email);
    const hit = await request(app)
      .get(`${api}/search`)
      .query({ q: stu.studentNumber, types: 'student' })
      .set(bearer(a));
    expect(hit.body.data.groups[0].items[0]).toMatchObject({ type: 'student', id: student.id });
    const miss = await request(app)
      .get(`${api}/search`)
      .query({ q: stu.studentNumber, types: 'student' })
      .set(bearer(b));
    expect(miss.body.data.total).toBe(0);
    await request(app).get(`${api}/search`).query({ q: 'x' }).set(bearer(a)).expect(400);
  });
});

describe('background jobs', () => {
  it('are visible to super administrators only', async () => {
    const admin = await login(app, (await createUser({ roles: ['SUPER_ADMIN'] })).email);
    const other = await login(app, (await createUser({ roles: ['DEPARTMENT_ADMIN'] })).email);
    await request(app).get(`${api}/jobs`).set(bearer(other)).expect(403);
    const res = await request(app).get(`${api}/jobs`).set(bearer(admin)).expect(200);
    expect(res.body.data.queues.length).toBeGreaterThan(0);
    expect(res.body.data.failed).toEqual([]);
    await request(app)
      .post(`${api}/jobs/email/does-not-exist/retry`)
      .set(bearer(admin))
      .expect(404);
    await request(app).post(`${api}/jobs/bogus/1/retry`).set(bearer(admin)).expect(404);
  });
});

describe('documents', () => {
  it('publishes to the chosen audience and department and scopes management', async () => {
    const dept = await createDepartment();
    const other = await createDepartment();
    const program = await createProgram(dept.id);
    const otherProgram = await createProgram(other.id);
    const deptAdminUser = await createUser({ roles: [] });
    await grantScoped(deptAdminUser.id, 'DEPARTMENT_ADMIN', {
      scopeType: 'DEPARTMENT',
      scopeId: dept.id,
    });
    const deptAdmin = await login(app, deptAdminUser.email);
    const student = await login(app, (await createStudentRecord(program.id)).user.email);
    const outsider = await login(app, (await createStudentRecord(otherProgram.id)).user.email);
    const faculty = await login(app, (await createFacultyRecord(dept.id)).user.email);

    expect((await uploadDocument(student)).status).toBe(403);
    const { fileId } = await uploadDocument(deptAdmin);
    // Department administrators cannot publish university-wide.
    await request(app)
      .post(`${api}/documents`)
      .set(bearer(deptAdmin))
      .send({ title: 'Lab safety', category: 'Policies', visibility: 'STUDENTS', fileId })
      .expect(403);
    const created = await request(app)
      .post(`${api}/documents`)
      .set(bearer(deptAdmin))
      .send({
        title: 'Lab safety',
        category: 'Policies',
        visibility: 'STUDENTS',
        departmentId: dept.id,
        fileId,
      })
      .expect(201);
    const id = created.body.data.id;

    const mine = await request(app).get(`${api}/documents`).set(bearer(student)).expect(200);
    expect(mine.body.data.items.map((d: { id: string }) => d.id)).toEqual([id]);
    expect(mine.body.data.categories).toEqual(['Policies']);
    for (const s of [outsider, faculty]) {
      const none = await request(app).get(`${api}/documents`).set(bearer(s)).expect(200);
      expect(none.body.data.items).toEqual([]);
      await request(app).get(`${api}/documents/${id}/download`).set(bearer(s)).expect(404);
    }
    const link = await request(app)
      .get(`${api}/documents/${id}/download`)
      .set(bearer(student))
      .expect(200);
    expect(link.body.data.url).toBeTruthy();

    const superAdmin = await login(app, (await createUser({ roles: ['SUPER_ADMIN'] })).email);
    const managed = await request(app)
      .get(`${api}/documents`)
      .query({ manage: 'true' })
      .set(bearer(superAdmin));
    expect(managed.body.data.items[0]).toMatchObject({ id, canManage: true });
    await request(app).delete(`${api}/documents/${id}`).set(bearer(student)).expect(403);
    await request(app).delete(`${api}/documents/${id}`).set(bearer(deptAdmin)).expect(200);
    expect(await prisma.storedFile.count({ where: { id: fileId } })).toBe(0);
  });
});
