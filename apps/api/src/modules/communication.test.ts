import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { prisma } from '../infrastructure/database/prisma.js';
import { closeQueues } from '../infrastructure/queues/queues.js';
import { resetState } from '../tests/db.js';
import {
  bearer,
  createCourse,
  createDepartment,
  createFacultyRecord,
  createProgram,
  createSchool,
  createSection,
  createSession,
  createStudentRecord,
  createUser,
  grantScoped,
  login,
} from '../tests/factories.js';
import { fanOutAnnouncement } from './announcements/announcements.service.js';
import { closeResolvedTickets } from './support/tickets.service.js';

const app = createApp();
const api = '/api/v1';
const DAY = 24 * 3600_000;

beforeEach(resetState);
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
});

/** One department with a running section: an instructor, two enrolled students, one outsider. */
async function world() {
  const school = await createSchool();
  const dept = await createDepartment(school.id);
  const otherDept = await createDepartment(school.id);
  const program = await createProgram(dept.id);
  const session = await createSession({ status: 'ACTIVE' });
  const course = await createCourse(dept.id, { code: 'COM101' });
  const teacher = await createFacultyRecord(dept.id);
  const section = await createSection(course.id, session.id, {
    status: 'PUBLISHED',
    instructorId: teacher.member.id,
  });
  const [s1, s2, outsider] = await Promise.all([
    createStudentRecord(program.id, { yearOfStudy: 2 }),
    createStudentRecord(program.id, { yearOfStudy: 2 }),
    createStudentRecord(program.id, { yearOfStudy: 3 }),
  ]);
  for (const s of [s1, s2])
    await prisma.courseRegistration.create({
      data: {
        studentId: s.student.id,
        sectionId: section.id,
        courseId: course.id,
        sessionId: session.id,
        status: 'REGISTERED',
        credits: 3,
      },
    });
  const deptAdmin = await createUser();
  await grantScoped(deptAdmin.id, 'DEPARTMENT_ADMIN', {
    scopeType: 'DEPARTMENT',
    scopeId: dept.id,
  });
  const otherAdmin = await createUser();
  await grantScoped(otherAdmin.id, 'DEPARTMENT_ADMIN', {
    scopeType: 'DEPARTMENT',
    scopeId: otherDept.id,
  });
  const superAdmin = await createUser({ roles: ['SUPER_ADMIN'] });
  const [tAuth, a1, a2, aOut, aDept, aOther, aSuper] = await Promise.all([
    login(app, teacher.user.email),
    login(app, s1.user.email),
    login(app, s2.user.email),
    login(app, outsider.user.email),
    login(app, deptAdmin.email),
    login(app, otherAdmin.email),
    login(app, superAdmin.email),
  ]);
  return {
    school,
    dept,
    otherDept,
    program,
    session,
    course,
    section,
    teacher: { ...teacher, auth: tAuth },
    s1: { ...s1, auth: a1 },
    s2: { ...s2, auth: a2 },
    outsider: { ...outsider, auth: aOut },
    deptAdmin: { user: deptAdmin, auth: aDept },
    otherAdmin: { user: otherAdmin, auth: aOther },
    superAdmin: { user: superAdmin, auth: aSuper },
  };
}
type World = Awaited<ReturnType<typeof world>>;

describe('direct messaging (FR-COMM-001/002/004/005/006)', () => {
  it('applies the contact rules', async () => {
    const w = await world();
    const send = (from: { auth: { accessToken: string } }, userId: string) =>
      request(app)
        .post(`${api}/conversations/direct`)
        .set(bearer(from.auth))
        .send({ userId, body: 'Hello' });

    await send(w.s1, w.teacher.user.id).expect(201);
    await send(w.teacher, w.s2.user.id).expect(201);
    await send(w.deptAdmin, w.outsider.user.id).expect(201);
    await send(w.teacher, w.deptAdmin.user.id).expect(201);
    const peer = await send(w.s1, w.s2.user.id).expect(403);
    expect(peer.body.error.code).toBe('MESSAGING_NOT_ALLOWED');
    const admin = await send(w.s1, w.deptAdmin.user.id).expect(403);
    expect(admin.body.message).toMatch(/University support/);
    await send(w.teacher, w.outsider.user.id).expect(403);
    await send(w.outsider, w.teacher.user.id).expect(403);

    const contacts = await request(app)
      .get(`${api}/conversations/contacts`)
      .set(bearer(w.s1.auth))
      .expect(200);
    expect(contacts.body.data.map((c: { userId: string }) => c.userId)).toEqual([
      w.teacher.user.id,
    ]);
    // Once a conversation exists, the student can reply to the administrator who wrote to them.
    const fromAdmin = await send(w.deptAdmin, w.s1.user.id).expect(201);
    await request(app)
      .post(`${api}/conversations/${fromAdmin.body.data.conversationId}/messages`)
      .set(bearer(w.s1.auth))
      .send({ body: 'Thanks!' })
      .expect(201);
  });

  it('tracks unread messages, notifies once per unread streak, edits, deletes and searches', async () => {
    const w = await world();
    const first = await request(app)
      .post(`${api}/conversations/direct`)
      .set(bearer(w.s1.auth))
      .send({ userId: w.teacher.user.id, body: 'Question about the recursion assignment' })
      .expect(201);
    const id = first.body.data.conversationId;
    await request(app)
      .post(`${api}/conversations/${id}/messages`)
      .set(bearer(w.s1.auth))
      .send({ body: 'Also: is late submission allowed?' })
      .expect(201);

    const unread = await request(app)
      .get(`${api}/conversations/unread-count`)
      .set(bearer(w.teacher.auth))
      .expect(200);
    expect(unread.body.data.total).toBe(2);
    expect(
      await prisma.notification.count({
        where: { userId: w.teacher.user.id, category: 'MESSAGE' },
      }),
    ).toBe(1);

    const list = await request(app)
      .get(`${api}/conversations`)
      .set(bearer(w.teacher.auth))
      .expect(200);
    const direct = list.body.data.find((c: { id: string }) => c.id === id);
    expect(direct).toMatchObject({ type: 'DIRECT', unread: 2, title: expect.any(String) });
    expect(direct.lastMessage.preview).toMatch(/late submission/);

    await request(app)
      .post(`${api}/conversations/${id}/read`)
      .set(bearer(w.teacher.auth))
      .expect(200);
    const after = await request(app)
      .get(`${api}/conversations/unread-count`)
      .set(bearer(w.teacher.auth))
      .expect(200);
    expect(after.body.data.total).toBe(0);

    // Edit window: allowed now, refused after 15 minutes.
    const msgId = first.body.data.message.id;
    await request(app)
      .patch(`${api}/messages/${msgId}`)
      .set(bearer(w.s1.auth))
      .send({ body: 'Question about the recursion homework' })
      .expect(200);
    await request(app)
      .patch(`${api}/messages/${msgId}`)
      .set(bearer(w.teacher.auth))
      .send({ body: 'hijack' })
      .expect(403);
    await prisma.message.update({
      where: { id: msgId },
      data: { createdAt: new Date(Date.now() - 16 * 60_000) },
    });
    const late = await request(app)
      .patch(`${api}/messages/${msgId}`)
      .set(bearer(w.s1.auth))
      .send({ body: 'again' })
      .expect(422);
    expect(late.body.error.code).toBe('EDIT_WINDOW_PASSED');

    const search = await request(app)
      .get(`${api}/conversations/search?q=recursion homework`)
      .set(bearer(w.teacher.auth))
      .expect(200);
    expect(search.body.data.map((m: { id: string }) => m.id)).toEqual([msgId]);
    const stranger = await request(app)
      .get(`${api}/conversations/search?q=recursion`)
      .set(bearer(w.s2.auth))
      .expect(200);
    expect(stranger.body.data).toEqual([]);
    await request(app).get(`${api}/conversations/${id}`).set(bearer(w.s2.auth)).expect(404);

    await request(app).delete(`${api}/messages/${msgId}`).set(bearer(w.s1.auth)).expect(200);
    const page = await request(app)
      .get(`${api}/conversations/${id}/messages`)
      .set(bearer(w.teacher.auth))
      .expect(200);
    expect(page.body.data.items[0]).toMatchObject({ id: msgId, deleted: true, body: null });
    expect(page.body.data.items).toHaveLength(2);
  });
});

describe('section conversations (FR-COMM-003)', () => {
  it('follows the roster and supports announcement-only mode', async () => {
    const w = await world();
    const list = await request(app).get(`${api}/conversations`).set(bearer(w.s1.auth)).expect(200);
    const conv = list.body.data.find((c: { type: string }) => c.type === 'SECTION');
    expect(conv).toMatchObject({
      section: { id: w.section.id },
      canPost: true,
      canModerate: false,
    });

    await request(app)
      .post(`${api}/conversations/${conv.id}/messages`)
      .set(bearer(w.s1.auth))
      .send({ body: 'Study group on Thursday?' })
      .expect(201);
    // s2 never opened messaging, but is synced in when someone posts.
    const s2Unread = await request(app)
      .get(`${api}/conversations/unread-count`)
      .set(bearer(w.s2.auth))
      .expect(200);
    expect(s2Unread.body.data.total).toBe(1);

    await request(app)
      .patch(`${api}/conversations/${conv.id}`)
      .set(bearer(w.s1.auth))
      .send({ announcementOnly: true })
      .expect(403);
    await request(app)
      .patch(`${api}/conversations/${conv.id}`)
      .set(bearer(w.teacher.auth))
      .send({ announcementOnly: true })
      .expect(200);
    const blocked = await request(app)
      .post(`${api}/conversations/${conv.id}/messages`)
      .set(bearer(w.s1.auth))
      .send({ body: 'Anyone?' })
      .expect(403);
    expect(blocked.body.error.code).toBe('MESSAGING_NOT_ALLOWED');
    await request(app)
      .post(`${api}/conversations/${conv.id}/messages`)
      .set(bearer(w.teacher.auth))
      .send({ body: 'Lab moved to room 204.' })
      .expect(201);

    await prisma.courseRegistration.updateMany({
      where: { studentId: w.s2.student.id },
      data: { status: 'DROPPED' },
    });
    await request(app).get(`${api}/conversations/${conv.id}`).set(bearer(w.s2.auth)).expect(404);
    await request(app)
      .get(`${api}/conversations/${conv.id}`)
      .set(bearer(w.outsider.auth))
      .expect(404);
  });

  it('routes the support inbox to administrators of the student’s department', async () => {
    const w = await world();
    const opened = await request(app)
      .post(`${api}/conversations/support`)
      .set(bearer(w.s1.auth))
      .send({ body: 'My fee receipt is missing' })
      .expect(201);
    const id = opened.body.data.conversationId;

    const inbox = await request(app)
      .get(`${api}/conversations?box=support`)
      .set(bearer(w.deptAdmin.auth))
      .expect(200);
    expect(inbox.body.data.map((c: { id: string }) => c.id)).toEqual([id]);
    const other = await request(app)
      .get(`${api}/conversations?box=support`)
      .set(bearer(w.otherAdmin.auth))
      .expect(200);
    expect(other.body.data).toEqual([]);
    await request(app).get(`${api}/conversations?box=support`).set(bearer(w.s1.auth)).expect(403);
    await request(app).get(`${api}/conversations/${id}`).set(bearer(w.otherAdmin.auth)).expect(404);

    await request(app)
      .post(`${api}/conversations/${id}/messages`)
      .set(bearer(w.deptAdmin.auth))
      .send({ body: 'We have re-issued it.' })
      .expect(201);
    const note = await prisma.notification.findFirstOrThrow({
      where: { userId: w.s1.user.id, category: 'MESSAGE' },
    });
    expect(note).toMatchObject({ title: 'University support replied' });
    expect(note.link).toBe(`/student/messages?c=${id}`);
  });
});

describe('section discussions (FR-COMM-007)', () => {
  it('lets members ask and answer, and instructors moderate', async () => {
    const w = await world();
    const thread = await request(app)
      .post(`${api}/course-sections/${w.section.id}/discussions`)
      .set(bearer(w.s1.auth))
      .send({ type: 'QUESTION', title: 'Big-O of merge sort?', body: 'Is it n log n always?' })
      .expect(201);
    const id = thread.body.data.id;
    await request(app)
      .post(`${api}/course-sections/${w.section.id}/discussions`)
      .set(bearer(w.outsider.auth))
      .send({ title: 'Hello there', body: 'x' })
      .expect(404);

    const reply = await request(app)
      .post(`${api}/discussions/${id}/posts`)
      .set(bearer(w.s2.auth))
      .send({ body: 'Yes, in every case.' })
      .expect(201);
    expect(
      await prisma.notification.count({ where: { userId: w.s1.user.id, category: 'MESSAGE' } }),
    ).toBe(1);

    await request(app)
      .patch(`${api}/discussions/${id}`)
      .set(bearer(w.s1.auth))
      .send({ answerPostId: reply.body.data.id })
      .expect(403);
    const marked = await request(app)
      .patch(`${api}/discussions/${id}`)
      .set(bearer(w.teacher.auth))
      .send({ answerPostId: reply.body.data.id, pinned: true, locked: true })
      .expect(200);
    expect(marked.body.data).toMatchObject({ answered: true, pinned: true, locked: true });
    expect(marked.body.data.posts[0]).toMatchObject({ isAnswer: true });

    const locked = await request(app)
      .post(`${api}/discussions/${id}/posts`)
      .set(bearer(w.s2.auth))
      .send({ body: 'one more thing' })
      .expect(422);
    expect(locked.body.error.code).toBe('THREAD_LOCKED');

    const list = await request(app)
      .get(`${api}/course-sections/${w.section.id}/discussions?unanswered=true`)
      .set(bearer(w.s2.auth))
      .expect(200);
    expect(list.body.data.items).toEqual([]);
    const boards = await request(app)
      .get(`${api}/discussions/boards`)
      .set(bearer(w.s2.auth))
      .expect(200);
    expect(boards.body.data).toEqual([expect.objectContaining({ id: w.section.id, threads: 1 })]);
  });
});

describe('announcements (FR-COMM-008..011)', () => {
  const post = (w: World, who: keyof World, body: object) =>
    request(app)
      .post(`${api}/announcements`)
      .set(bearer((w[who] as { auth: { accessToken: string } }).auth))
      .send({ title: 'Notice', body: 'Read me', ...body });

  it('enforces who may target what', async () => {
    const w = await world();
    await post(w, 'deptAdmin', {
      audiences: [{ type: 'DEPARTMENT', targetId: w.dept.id, roleFilter: 'STUDENT' }],
    }).expect(201);
    await post(w, 'deptAdmin', {
      audiences: [{ type: 'YEAR_OF_STUDY', targetValue: 2, targetId: w.dept.id }],
    }).expect(201);
    const outside = await post(w, 'deptAdmin', {
      audiences: [{ type: 'DEPARTMENT', targetId: w.otherDept.id }],
    }).expect(403);
    expect(outside.body.error.code).toBe('AUDIENCE_NOT_ALLOWED');
    await post(w, 'deptAdmin', { audiences: [{ type: 'ALL_STUDENTS' }] }).expect(403);
    await post(w, 'deptAdmin', { audiences: [{ type: 'SCHOOL', targetId: w.school.id }] }).expect(
      403,
    );
    await post(w, 'superAdmin', { audiences: [{ type: 'ALL_STUDENTS' }] }).expect(201);
    await post(w, 'teacher', { audiences: [{ type: 'COURSE', targetId: w.course.id }] }).expect(
      201,
    );
    await post(w, 'teacher', { audiences: [{ type: 'DEPARTMENT', targetId: w.dept.id }] }).expect(
      403,
    );
    await post(w, 's1', { sectionIds: [w.section.id] }).expect(403);
  });

  it('resolves audiences per reader, schedules, fans out once and tracks reads', async () => {
    const w = await world();
    const now = await post(w, 'deptAdmin', {
      title: 'Year 2 orientation',
      audiences: [{ type: 'YEAR_OF_STUDY', targetValue: 2, targetId: w.dept.id }],
    }).expect(201);
    const later = await post(w, 'deptAdmin', {
      title: 'Exam timetable',
      publishAt: new Date(Date.now() + DAY).toISOString(),
      audiences: [{ type: 'DEPARTMENT', targetId: w.dept.id }],
    }).expect(201);
    expect(later.body.data).toMatchObject({ scheduled: true });

    const feed = async (who: { auth: { accessToken: string } }) =>
      (await request(app).get(`${api}/announcements/feed`).set(bearer(who.auth)).expect(200)).body
        .data;
    expect((await feed(w.s1)).items.map((a: { title: string }) => a.title)).toEqual([
      'Year 2 orientation',
    ]);
    expect((await feed(w.outsider)).items).toEqual([]);
    expect((await feed(w.s1)).unread).toBe(1);

    // Fan-out: once, to the matching students only; a scheduled one waits for its time.
    expect(await fanOutAnnouncement(now.body.data.id)).toEqual({ notified: 2 });
    expect(await fanOutAnnouncement(now.body.data.id)).toEqual({ notified: 0 });
    expect(await fanOutAnnouncement(later.body.data.id)).toEqual({ notified: 0 });

    // Rescheduling to now makes it visible and deliverable (teacher + 3 students).
    await request(app)
      .patch(`${api}/announcements/${later.body.data.id}`)
      .set(bearer(w.deptAdmin.auth))
      .send({ publishAt: new Date().toISOString() })
      .expect(200);
    expect(await fanOutAnnouncement(later.body.data.id)).toEqual({ notified: 4 });
    expect((await feed(w.outsider)).items.map((a: { title: string }) => a.title)).toEqual([
      'Exam timetable',
    ]);

    await request(app)
      .post(`${api}/announcements/${now.body.data.id}/read`)
      .set(bearer(w.s1.auth))
      .expect(200);
    await request(app)
      .post(`${api}/announcements/${now.body.data.id}/read`)
      .set(bearer(w.outsider.auth))
      .expect(404);
    const s1 = await feed(w.s1);
    expect(s1.items.find((a: { title: string }) => a.title === 'Year 2 orientation').read).toBe(
      true,
    );
    const managed = await request(app)
      .get(`${api}/announcements/manage`)
      .set(bearer(w.deptAdmin.auth))
      .expect(200);
    expect(managed.body.data.map((a: { readCount: number }) => a.readCount)).toContain(1);
  });
});

describe('notification preferences and email (FR-NOTIF-004/005)', () => {
  it('respects opt-outs, keeps mandatory channels and logs emails', async () => {
    const w = await world();
    const prefs = await request(app)
      .get(`${api}/notifications/preferences`)
      .set(bearer(w.s1.auth))
      .expect(200);
    expect(
      prefs.body.data.find((p: { category: string }) => p.category === 'REGISTRATION'),
    ).toMatchObject({ channels: [{ mandatory: true }, { mandatory: true }] });
    const refused = await request(app)
      .put(`${api}/notifications/preferences`)
      .set(bearer(w.s1.auth))
      .send({ preferences: [{ category: 'REGISTRATION', channel: 'EMAIL', enabled: false }] })
      .expect(422);
    expect(refused.body.error.details.fields[0].message).toMatch(/mandatory/);
    await request(app)
      .put(`${api}/notifications/preferences`)
      .set(bearer(w.s1.auth))
      .send({ preferences: [{ category: 'ANNOUNCEMENT', channel: 'IN_APP', enabled: false }] })
      .expect(200);

    const a = await request(app)
      .post(`${api}/announcements`)
      .set(bearer(w.teacher.auth))
      .send({
        title: 'Urgent: room change',
        body: 'Room 204',
        priority: 'URGENT',
        sectionIds: [w.section.id],
      })
      .expect(201);
    await fanOutAnnouncement(a.body.data.id);
    expect(
      await prisma.notification.count({
        where: { userId: w.s1.user.id, category: 'ANNOUNCEMENT' },
      }),
    ).toBe(0);
    expect(
      await prisma.notification.count({
        where: { userId: w.s2.user.id, category: 'ANNOUNCEMENT' },
      }),
    ).toBe(1);
    // Urgent announcements are emailed to everyone they reach, opted out of in-app or not.
    const emails = await prisma.emailLog.findMany({ where: { kind: 'notification:announcement' } });
    expect(emails.map((e) => e.toAddress).sort()).toEqual(
      [w.s1.user.email, w.s2.user.email].sort(),
    );
    expect(emails[0]).toMatchObject({ status: 'QUEUED', subject: 'Urgent: Urgent: room change' });
  });
});

describe('feedback (FR-COMM-012)', () => {
  it('hides anonymous submitters from scoped administrators and notifies on responses', async () => {
    const w = await world();
    const created = await request(app)
      .post(`${api}/feedback`)
      .set(bearer(w.s1.auth))
      .send({
        category: 'COURSE',
        subject: 'Lab equipment',
        description: 'Half of the lab machines are broken.',
        courseId: w.course.id,
        anonymous: true,
      })
      .expect(201);
    const id = created.body.data.id;
    expect(created.body.data).toMatchObject({ mine: true, submittedBy: { id: w.s1.user.id } });

    const queue = await request(app)
      .get(`${api}/feedback`)
      .set(bearer(w.deptAdmin.auth))
      .expect(200);
    expect(queue.body.data).toEqual([
      expect.objectContaining({
        id,
        submittedBy: null,
        department: expect.objectContaining({ id: w.dept.id }),
      }),
    ]);
    const sup = await request(app)
      .get(`${api}/feedback/${id}`)
      .set(bearer(w.superAdmin.auth))
      .expect(200);
    expect(sup.body.data.submittedBy).toMatchObject({ id: w.s1.user.id });
    await request(app).get(`${api}/feedback/${id}`).set(bearer(w.otherAdmin.auth)).expect(404);
    await request(app).get(`${api}/feedback/${id}`).set(bearer(w.s2.auth)).expect(404);

    await request(app)
      .post(`${api}/feedback/${id}/responses`)
      .set(bearer(w.deptAdmin.auth))
      .send({ body: 'Replacements ordered.' })
      .expect(201);
    const resolved = await request(app)
      .patch(`${api}/feedback/${id}`)
      .set(bearer(w.deptAdmin.auth))
      .send({
        status: 'RESOLVED',
        resolutionNote: 'All machines replaced.',
        assigneeId: w.deptAdmin.user.id,
      })
      .expect(200);
    expect(resolved.body.data).toMatchObject({
      status: 'RESOLVED',
      resolvedAt: expect.any(String),
    });
    await request(app)
      .patch(`${api}/feedback/${id}`)
      .set(bearer(w.deptAdmin.auth))
      .send({ assigneeId: w.otherAdmin.user.id })
      .expect(422);
    const notes = await prisma.notification.findMany({
      where: { userId: w.s1.user.id, category: 'FEEDBACK' },
      orderBy: { createdAt: 'asc' },
    });
    expect(notes.map((n) => n.title)).toEqual([
      'Response to your feedback: Lab equipment',
      'Feedback resolved: Lab equipment',
    ]);
    expect(notes[0]!.link).toBe(`/student/feedback/${id}`);
  });
});

describe('support tickets (FR-COMM-013/014)', () => {
  it('numbers tickets, hides internal notes and handles resolve, reopen and auto-close', async () => {
    const w = await world();
    const create = () =>
      request(app)
        .post(`${api}/tickets`)
        .set(bearer(w.s1.auth))
        .send({
          category: 'REGISTRATION',
          subject: 'Cannot add COM101',
          description: 'The register button does nothing for me.',
        })
        .expect(201);
    const t = (await create()).body.data;
    const year = new Date().getUTCFullYear();
    expect(t.ticketNumber).toBe(`TCK-${year}-000001`);
    expect((await create()).body.data.ticketNumber).toBe(`TCK-${year}-000002`);

    const queue = await request(app)
      .get(`${api}/tickets?status=ACTIVE`)
      .set(bearer(w.deptAdmin.auth))
      .expect(200);
    expect(queue.body.meta.total).toBe(2);
    const none = await request(app)
      .get(`${api}/tickets`)
      .set(bearer(w.otherAdmin.auth))
      .expect(200);
    expect(none.body.meta.total).toBe(0);

    await request(app)
      .post(`${api}/tickets/${t.id}/responses`)
      .set(bearer(w.deptAdmin.auth))
      .send({ body: 'Checking the logs — student had a hold.', internal: true })
      .expect(201);
    await request(app)
      .post(`${api}/tickets/${t.id}/responses`)
      .set(bearer(w.deptAdmin.auth))
      .send({ body: 'Fixed: your hold was released.', status: 'RESOLVED' })
      .expect(201);
    await request(app)
      .post(`${api}/tickets/${t.id}/responses`)
      .set(bearer(w.s1.auth))
      .send({ body: 'note', internal: true })
      .expect(403);

    const mine = await request(app)
      .get(`${api}/tickets/${t.id}`)
      .set(bearer(w.s1.auth))
      .expect(200);
    expect(mine.body.data.responses.map((r: { body: string }) => r.body)).toEqual([
      'Fixed: your hold was released.',
    ]);
    expect(mine.body.data).toMatchObject({ status: 'RESOLVED', canReopen: true, canReply: false });
    const staff = await request(app)
      .get(`${api}/tickets/${t.id}`)
      .set(bearer(w.deptAdmin.auth))
      .expect(200);
    expect(staff.body.data.responses).toHaveLength(2);
    expect(staff.body.data.events.map((e: { type: string }) => e.type)).toEqual([
      'CREATED',
      'STATUS_CHANGED',
    ]);
    expect(
      await prisma.notification.count({ where: { userId: w.s1.user.id, category: 'TICKET' } }),
    ).toBe(1);

    await request(app).post(`${api}/tickets/${t.id}/reopen`).set(bearer(w.s1.auth)).expect(200);
    await request(app)
      .patch(`${api}/tickets/${t.id}`)
      .set(bearer(w.deptAdmin.auth))
      .send({ status: 'RESOLVED' })
      .expect(200);
    await prisma.supportTicket.update({
      where: { id: t.id },
      data: { resolvedAt: new Date(Date.now() - 8 * DAY) },
    });
    await request(app).post(`${api}/tickets/${t.id}/reopen`).set(bearer(w.s1.auth)).expect(422);
    expect(await closeResolvedTickets()).toEqual({ closed: 1 });
    const closed = await request(app)
      .get(`${api}/tickets/${t.id}`)
      .set(bearer(w.s1.auth))
      .expect(200);
    expect(closed.body.data).toMatchObject({ status: 'CLOSED', canReply: false });
    await request(app).get(`${api}/tickets/${t.id}`).set(bearer(w.s2.auth)).expect(404);
  });
});
