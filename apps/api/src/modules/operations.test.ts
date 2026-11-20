import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { prisma } from '../infrastructure/database/prisma.js';
import { deliverEmail, enqueueEmail } from '../infrastructure/email/outbox.js';
import { closeQueues } from '../infrastructure/queues/queues.js';
import { resetState } from '../tests/db.js';
import {
  bearer,
  createClassroom,
  createCourse,
  createDepartment,
  createFacultyRecord,
  createProgram,
  createSchool,
  createSection,
  createSession,
  createStudentRecord,
  createUser,
  login,
} from '../tests/factories.js';
import { fanOutAnnouncement } from './announcements/announcements.service.js';

const app = createApp();
const api = '/api/v1';
const DAY = 24 * 3600_000;

beforeEach(resetState);
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
});

async function world() {
  const school = await createSchool();
  const dept = await createDepartment(school.id);
  const program = await createProgram(dept.id, { totalCredits: 40 });
  const spec = await prisma.specialization.create({
    data: { programId: program.id, code: 'AI', name: 'Artificial Intelligence' },
  });
  const session = await createSession({ status: 'ACTIVE' });
  await prisma.registrationPeriod.create({
    data: {
      sessionId: session.id,
      opensAt: new Date(Date.now() - DAY),
      closesAt: new Date(Date.now() + 7 * DAY),
      addDropDeadline: new Date(Date.now() + 14 * DAY),
      withdrawalDeadline: new Date(Date.now() + 30 * DAY),
    },
  });
  await prisma.sessionPolicy.create({
    data: { sessionId: session.id, maxCredits: 24, minCredits: 6 },
  });
  const teacher = await createFacultyRecord(dept.id);
  const a = await createCourse(dept.id, { code: 'OPS101', credits: 3 });
  const b = await createCourse(dept.id, { code: 'OPS102', credits: 3 });
  const sa = await createSection(a.id, session.id, {
    status: 'PUBLISHED',
    instructorId: teacher.member.id,
    meetings: [{ dayOfWeek: 1, startMinute: 540, endMinute: 600 }],
  });
  const sb = await createSection(b.id, session.id, {
    status: 'PUBLISHED',
    meetings: [{ dayOfWeek: 1, startMinute: 570, endMinute: 630 }],
  });
  const student = await createStudentRecord(program.id, { yearOfStudy: 2 });
  await prisma.student.update({
    where: { id: student.student.id },
    data: { specializationId: spec.id },
  });
  return {
    school,
    dept,
    program,
    spec,
    session,
    teacher,
    a,
    b,
    sa,
    sb,
    student,
    auth: await login(app, student.user.email),
  };
}

describe('course planner and academic records (FR-STUDENT-008, FR-ACAD-007)', () => {
  it('builds a plan, flags clashes, registers it and lists records', async () => {
    const w = await world();
    const plan = await request(app)
      .post(`${api}/course-plans`)
      .set(bearer(w.auth))
      .send({ sessionId: w.session.id, name: 'Main plan' })
      .expect(201);
    const id = plan.body.data.id;
    await request(app)
      .put(`${api}/course-plans/${id}/items`)
      .set(bearer(w.auth))
      .send({
        items: [
          { courseId: w.a.id, sectionId: w.sa.id },
          { courseId: w.b.id, sectionId: w.sb.id },
        ],
      })
      .expect(200);
    const check = await request(app)
      .get(`${api}/course-plans/${id}/validate`)
      .set(bearer(w.auth))
      .expect(200);
    expect(check.body.data.totalCredits).toBe(6);
    expect(
      check.body.data.items.flatMap((i: { problems: Array<{ code: string }> }) =>
        i.problems.map((p) => p.code),
      ),
    ).toContain('TIMETABLE_CONFLICT');

    // Without the clash the whole plan registers in one call.
    await request(app)
      .put(`${api}/course-plans/${id}/items`)
      .set(bearer(w.auth))
      .send({
        items: [
          { courseId: w.a.id, sectionId: w.sa.id },
          { courseId: w.b.id, sectionId: null },
        ],
      })
      .expect(200);
    const result = await request(app)
      .post(`${api}/course-plans/${id}/register`)
      .set(bearer(w.auth))
      .expect(200);
    expect(JSON.stringify(result.body.data)).toMatch(/REGISTERED/);
    const list = await request(app)
      .get(`${api}/course-plans?sessionId=${w.session.id}`)
      .set(bearer(w.auth))
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    const other = await login(app, (await createStudentRecord(w.program.id)).user.email);
    await request(app).get(`${api}/course-plans/${id}`).set(bearer(other)).expect(404);
    await request(app).delete(`${api}/course-plans/${id}`).set(bearer(w.auth)).expect(200);

    const mine = await request(app)
      .get(`${api}/academic-records/me`)
      .set(bearer(w.auth))
      .expect(200);
    expect(mine.body.data).toBeDefined();
    const registrar = await login(app, (await createUser({ roles: ['ACADEMIC_ADMIN'] })).email);
    await request(app)
      .get(`${api}/students/${w.student.student.id}/records`)
      .set(bearer(registrar))
      .expect(200);
    await request(app)
      .get(`${api}/students/${w.student.student.id}/records`)
      .set(bearer(other))
      .expect(404);
  });
});

describe('classrooms (FR-ACAD-002 data)', () => {
  it('creates, filters, updates, schedules and protects rooms in use', async () => {
    const w = await world();
    const registrar = await login(app, (await createUser({ roles: ['ACADEMIC_ADMIN'] })).email);
    const campus = await prisma.campus.create({ data: { code: 'NORTH', name: 'North campus' } });
    const created = await request(app)
      .post(`${api}/classrooms`)
      .set(bearer(registrar))
      .send({
        campusId: campus.id,
        building: 'Block Z',
        roomNumber: 'Z-1',
        capacity: 80,
        type: 'LECTURE_HALL',
        equipment: ['Projector', 'Projector'],
      })
      .expect(201);
    expect(created.body.data.equipment).toEqual(['Projector']);
    await request(app)
      .post(`${api}/classrooms`)
      .set(bearer(registrar))
      .send({
        campusId: campus.id,
        building: 'Block Z',
        roomNumber: 'Z-1',
        capacity: 80,
        type: 'LECTURE_HALL',
      })
      .expect(409);
    const list = await request(app)
      .get(`${api}/classrooms?campusId=${campus.id}&minCapacity=50`)
      .set(bearer(w.auth))
      .expect(200);
    expect(list.body.data.map((c: { id: string }) => c.id)).toEqual([created.body.data.id]);
    await request(app)
      .patch(`${api}/classrooms/${created.body.data.id}`)
      .set(bearer(registrar))
      .send({ capacity: 90 })
      .expect(200);
    await request(app)
      .get(`${api}/classrooms/${created.body.data.id}`)
      .set(bearer(w.auth))
      .expect(200);

    const used = await createClassroom();
    await prisma.sectionMeeting.updateMany({
      where: { sectionId: w.sa.id },
      data: { classroomId: used.id },
    });
    const schedule = await request(app)
      .get(`${api}/classrooms/${used.id}/schedule?sessionId=${w.session.id}`)
      .set(bearer(w.auth))
      .expect(200);
    expect(schedule.body.data).toHaveLength(1);
    await request(app).delete(`${api}/classrooms/${used.id}`).set(bearer(registrar)).expect(422);
    await request(app)
      .delete(`${api}/classrooms/${created.body.data.id}`)
      .set(bearer(registrar))
      .expect(200);
  });
});

describe('email outbox (FR-NOTIF-005)', () => {
  it('logs queued emails and records delivery', async () => {
    await enqueueEmail({ to: 'someone@test.edu', subject: 'Hello', text: 'Body' }, 'test');
    const log = await prisma.emailLog.findFirstOrThrow({
      where: { toAddress: 'someone@test.edu' },
    });
    expect(log).toMatchObject({ status: 'QUEUED', kind: 'test' });
    await deliverEmail(
      { to: 'someone@test.edu', subject: 'Hello', text: 'Body', logId: log.id },
      { number: 1, final: false },
    );
    expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: log.id } })).toMatchObject({
      status: 'SENT',
      attempts: 1,
    });
  });
});

describe('every report runs (FR-RPT-001)', () => {
  it('returns rows for all fifteen reports', async () => {
    const w = await world();
    await prisma.courseRegistration.create({
      data: {
        studentId: w.student.student.id,
        sectionId: w.sa.id,
        courseId: w.a.id,
        sessionId: w.session.id,
        status: 'PENDING',
        credits: 3,
      },
    });
    const admin = await login(app, (await createUser({ roles: ['UNIVERSITY_ADMIN'] })).email);
    const catalogue = await request(app).get(`${api}/reports`).set(bearer(admin)).expect(200);
    for (const r of catalogue.body.data as Array<{
      key: string;
      columns: Array<{ key: string }>;
    }>) {
      const res = await request(app)
        .get(`${api}/reports/${r.key}?sort=${r.columns[0]!.key}:desc&q=a`)
        .set(bearer(admin));
      expect(res.status, r.key).toBe(200);
      expect(Array.isArray(res.body.data.rows), r.key).toBe(true);
      const plain = await request(app)
        .get(`${api}/reports/${r.key}`)
        .set(bearer(admin))
        .expect(200);
      expect(plain.body.data.total, r.key).toBeGreaterThanOrEqual(0);
    }
    const incomplete = await request(app)
      .get(`${api}/reports/incomplete-registrations`)
      .set(bearer(admin))
      .expect(200);
    expect(incomplete.body.data.rows[0]).toMatchObject({ registered: 3, minimum: 6, pending: 1 });
  });
});

describe('announcement audiences (FR-COMM-008/009)', () => {
  it('resolves school, programme, specialization, course and user audiences', async () => {
    const w = await world();
    await prisma.courseRegistration.create({
      data: {
        studentId: w.student.student.id,
        sectionId: w.sa.id,
        courseId: w.a.id,
        sessionId: w.session.id,
        status: 'REGISTERED',
        credits: 3,
      },
    });
    const admin = await login(app, (await createUser({ roles: ['SUPER_ADMIN'] })).email);
    const post = (audiences: object[]) =>
      request(app)
        .post(`${api}/announcements`)
        .set(bearer(admin))
        .send({ title: 'Audience test', body: 'x', audiences })
        .expect(201);
    const cases: Array<[object[], number]> = [
      [[{ type: 'SCHOOL', targetId: w.school.id, roleFilter: 'FACULTY' }], 1],
      [[{ type: 'PROGRAM', targetId: w.program.id }], 1],
      [[{ type: 'SPECIALIZATION', targetId: w.spec.id }], 1],
      [[{ type: 'COURSE', targetId: w.a.id }], 2],
      [[{ type: 'USER', targetId: w.student.user.id }], 1],
      // The only administrator is the author, who is never notified.
      [[{ type: 'ALL_FACULTY' }, { type: 'ALL_ADMINS' }], 1],
    ];
    for (const [audiences, expected] of cases) {
      const a = await post(audiences);
      expect(await fanOutAnnouncement(a.body.data.id), JSON.stringify(audiences)).toEqual({
        notified: expected,
      });
      expect(a.body.data.audiences[0].label).not.toBe('Removed');
    }
    const feed = await request(app)
      .get(`${api}/announcements/feed`)
      .set(bearer(w.auth))
      .expect(200);
    expect(feed.body.data.items).toHaveLength(4);
  });
});

describe('per-user write limits (SECURITY.md §8)', () => {
  it('stops one user flooding conversations', async () => {
    const w = await world();
    const send = () =>
      request(app).post(`${api}/conversations/support`).set(bearer(w.auth)).send({ body: 'hi' });
    for (let i = 0; i < 30; i++) expect((await send()).status).toBe(201);
    const blocked = await send().expect(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeDefined();
  });
});

describe('daily email digest (FR-NOTIF-006)', () => {
  it('holds ordinary emails for the digest and still sends mandatory ones at once', async () => {
    const { queueNotifications, sendDigests } =
      await import('./notifications/notifications.service.js');
    const user = await createUser({ roles: ['STUDENT'] });
    const auth = await login(app, user.email);
    const on = await request(app)
      .put(`${api}/notifications/digest`)
      .set(bearer(auth))
      .send({ enabled: true })
      .expect(200);
    expect(on.body.data.enabled).toBe(true);
    await prisma.user.update({
      where: { id: user.id },
      data: { lastDigestAt: new Date(Date.now() - 60_000) },
    });
    const send = async (category: 'TICKET' | 'REGISTRATION', title: string) => {
      const after = await queueNotifications(prisma, [
        { userId: user.id, category, title, body: 'Body text', link: '/student/support' },
      ]);
      after();
      await new Promise((r) => setTimeout(r, 50));
    };
    await send('TICKET', 'Ticket replied');
    await send('REGISTRATION', 'Registration cancelled');
    const logs = () => prisma.emailLog.findMany({ where: { toAddress: user.email } });
    expect((await logs()).map((l) => l.kind)).toEqual(['notification:registration']);

    expect(await sendDigests(new Date(Date.now() + 25 * 3600_000))).toEqual({ users: 1, sent: 1 });
    const digest = (await logs()).find((l) => l.kind === 'notification:digest');
    expect(digest?.subject).toBe('Your daily summary: 1 update');
    // Already sent today: nothing more until tomorrow.
    expect(await sendDigests(new Date(Date.now() + 26 * 3600_000))).toEqual({ users: 0, sent: 0 });
  });
});
