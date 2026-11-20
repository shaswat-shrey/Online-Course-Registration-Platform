import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { RoleKey } from '@ucrams/shared';
import { createApp } from '../app.js';
import { prisma } from '../infrastructure/database/prisma.js';
import { closeQueues } from '../infrastructure/queues/queues.js';
import { resetState } from '../tests/db.js';
import {
  bearer,
  createCourse,
  createDepartment,
  createProgram,
  createSchool,
  createSection,
  createStudentRecord,
  createUser,
  grantScoped,
  login,
} from '../tests/factories.js';
import {
  expireClosedWaitlists,
  expireOffer,
  promoteSection,
  reconcileCounters,
} from './registrations/waitlist.service.js';

const app = createApp();
const api = '/api/v1';
const DAY = 24 * 3600_000;

beforeEach(resetState);
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
});

async function as(role: RoleKey) {
  const user = await createUser({ roles: [role] });
  return login(app, user.email);
}

/** An active session whose registration window is open now. */
async function openSession(
  policy: Record<string, unknown> = {},
  period: Partial<
    Record<'opensAt' | 'closesAt' | 'addDropDeadline' | 'withdrawalDeadline', Date>
  > & { lateClosesAt?: Date | null } = {},
) {
  const now = Date.now();
  const scale = await prisma.gradingScale.create({
    data: {
      name: `Scale ${now}${Math.random()}`,
      entries: {
        create: [
          { letter: 'A', minPercent: 80, gradePoints: 10, isPassing: true, position: 0 },
          { letter: 'B', minPercent: 65, gradePoints: 8, isPassing: true, position: 1 },
          { letter: 'C', minPercent: 50, gradePoints: 6, isPassing: true, position: 2 },
          { letter: 'D', minPercent: 40, gradePoints: 4, isPassing: true, position: 3 },
          { letter: 'F', minPercent: 0, gradePoints: 0, isPassing: false, position: 4 },
        ],
      },
    },
  });
  const year = await prisma.academicYear.create({
    data: {
      label: `${2100 + Math.floor(Math.random() * 800)}-${now}`.slice(0, 20),
      startDate: new Date('2026-07-01'),
      endDate: new Date('2027-06-30'),
    },
  });
  return prisma.academicSession.create({
    data: {
      academicYearId: year.id,
      code: `S${now}`.slice(0, 30),
      name: 'Test session',
      type: 'FALL',
      startDate: new Date('2026-08-03'),
      endDate: new Date('2026-12-18'),
      status: 'ACTIVE',
      gradingScaleId: scale.id,
      policy: {
        create: { maxCredits: 12, approvalMode: 'NONE', waitlistEnabled: true, ...policy },
      },
      registrationPeriod: {
        create: {
          opensAt: new Date(now - DAY),
          closesAt: new Date(now + 7 * DAY),
          addDropDeadline: new Date(now + 14 * DAY),
          withdrawalDeadline: new Date(now + 30 * DAY),
          ...period,
        },
      },
    },
  });
}

const MON_9 = { dayOfWeek: 1, startMinute: 540, endMinute: 600 };

async function world(policy: Record<string, unknown> = {}) {
  const school = await createSchool();
  const dept = await createDepartment(school.id);
  const other = await createDepartment(school.id);
  const program = await createProgram(dept.id);
  const session = await openSession(policy);
  const course = await createCourse(dept.id, { credits: 4 });
  const section = await createSection(course.id, session.id, {
    status: 'PUBLISHED',
    capacity: 30,
    meetings: [MON_9],
  });
  await prisma.courseSection.update({ where: { id: section.id }, data: { waitlistCapacity: 5 } });
  return { school, dept, other, program, session, course, section };
}

async function student(programId: string, yearOfStudy = 1) {
  const { user, student: s } = await createStudentRecord(programId, { yearOfStudy });
  return { ...s, auth: await login(app, user.email), userId: user.id };
}

const register = (
  who: { accessToken: string },
  sectionId: string,
  extra: Record<string, unknown> = {},
  key?: string,
) => {
  const r = request(app).post(`${api}/registrations`).set(bearer(who));
  if (key) r.set('Idempotency-Key', key);
  return r.send({ sectionId, ...extra });
};

describe('registration rules', () => {
  it('previews every rule, registers, counts the seat, records history and notifies', async () => {
    const w = await world();
    const s = await student(w.program.id);

    const preview = await request(app)
      .get(`${api}/registrations/eligibility?sectionId=${w.section.id}`)
      .set(bearer(s.auth))
      .expect(200);
    expect(preview.body.data).toMatchObject({ eligible: true, outcome: 'REGISTER' });
    expect(preview.body.data.rules).toHaveLength(12);

    const res = await register(s.auth, w.section.id).expect(201);
    expect(res.body.data).toMatchObject({
      status: 'REGISTERED',
      credits: 4,
      course: { code: w.course.code },
    });
    expect(
      (await prisma.courseSection.findUniqueOrThrow({ where: { id: w.section.id } })).enrolledCount,
    ).toBe(1);
    const events = await prisma.registrationEvent.findMany({
      where: { registrationId: res.body.data.id },
    });
    expect(events.map((e) => e.action)).toEqual(['REGISTERED']);
    const unread = await request(app)
      .get(`${api}/notifications/unread-count`)
      .set(bearer(s.auth))
      .expect(200);
    expect(unread.body.data.unread).toBe(1);

    // BR-002: a second section of the same course is a duplicate.
    const b = await createSection(w.course.id, w.session.id, {
      sectionCode: 'B',
      status: 'PUBLISHED',
    });
    expect((await register(s.auth, b.id).expect(409)).body.error.code).toBe(
      'DUPLICATE_REGISTRATION',
    );
  });

  it('AC-REG-002: reports missing prerequisites and enforces minimum grades', async () => {
    const w = await world();
    const intro = await createCourse(w.dept.id, { code: 'INTRO1' });
    const alt = await createCourse(w.dept.id, { code: 'ALT1' });
    const group = await prisma.prerequisiteGroup.create({
      data: { courseId: w.course.id, position: 0 },
    });
    await prisma.prerequisiteItem.createMany({
      data: [
        { groupId: group.id, requiredCourseId: intro.id, minGradeLetter: 'B' },
        { groupId: group.id, requiredCourseId: alt.id },
      ],
    });
    const s = await student(w.program.id);
    const res = await register(s.auth, w.section.id).expect(422);
    expect(res.body.error).toMatchObject({
      code: 'PREREQUISITE_NOT_MET',
      details: { missing: ['INTRO1 (min B) or ALT1'], overridable: 'PREREQUISITE' },
    });

    const record = (courseId: string, gradeLetter: string) =>
      prisma.academicRecord.create({
        data: {
          studentId: s.id,
          courseId,
          source: 'ENROLLMENT',
          courseCodeSnapshot: 'X',
          courseTitleSnapshot: 'X',
          creditsAttempted: 4,
          creditsEarned: 4,
          gradeLetter,
          passed: true,
        },
      });
    await record(intro.id, 'C'); // passed, but below the B minimum
    expect((await register(s.auth, w.section.id).expect(422)).body.error.code).toBe(
      'PREREQUISITE_NOT_MET',
    );
    await record(alt.id, 'D'); // the alternative has no minimum
    await register(s.auth, w.section.id).expect(201);
  });

  it('AC-REG-003 and AC-REG-004: credit limit details and timetable clashes', async () => {
    const w = await world({ maxCredits: 6 });
    const s = await student(w.program.id);
    await register(s.auth, w.section.id).expect(201);

    const clash = await createSection(
      (await createCourse(w.dept.id, { credits: 2 })).id,
      w.session.id,
      { status: 'PUBLISHED', meetings: [{ dayOfWeek: 1, startMinute: 570, endMinute: 630 }] },
    );
    const c = await register(s.auth, clash.id).expect(422);
    expect(c.body.error).toMatchObject({
      code: 'TIMETABLE_CONFLICT',
      details: { conflicts: [{ courseCode: w.course.code, sectionCode: 'A' }] },
    });

    const heavy = await createSection(
      (await createCourse(w.dept.id, { credits: 4 })).id,
      w.session.id,
      { status: 'PUBLISHED', meetings: [{ dayOfWeek: 2, startMinute: 540, endMinute: 600 }] },
    );
    const l = await register(s.auth, heavy.id).expect(422);
    expect(l.body.error).toMatchObject({
      code: 'CREDIT_LIMIT_EXCEEDED',
      details: { current: 4, attempted: 8, max: 6 },
    });
  });

  it('blocks holds, closed periods and restrictions; priority windows open earlier', async () => {
    const w = await world();
    const s = await student(w.program.id, 4);
    await prisma.registrationHold.create({
      data: { studentId: s.id, type: 'FINANCIAL', reason: 'Fees', placedById: s.userId },
    });
    expect((await register(s.auth, w.section.id).expect(422)).body.error.code).toBe(
      'REGISTRATION_HOLD',
    );
    await prisma.registrationHold.updateMany({
      where: { studentId: s.id },
      data: { releasedAt: new Date() },
    });

    const period = await prisma.registrationPeriod.findUniqueOrThrow({
      where: { sessionId: w.session.id },
    });
    await prisma.registrationPeriod.update({
      where: { id: period.id },
      data: { opensAt: new Date(Date.now() + DAY) },
    });
    const early = await register(s.auth, w.section.id).expect(422);
    expect(early.body.error.code).toBe('REGISTRATION_NOT_YET_OPEN');
    await prisma.priorityWindow.create({
      data: {
        periodId: period.id,
        name: 'Final year',
        opensAt: new Date(Date.now() - 3600_000),
        yearOfStudy: 4,
      },
    });

    await prisma.courseRestriction.create({
      data: { courseId: w.course.id, mode: 'EXCLUDE', targetType: 'YEAR_OF_STUDY', targetValue: 4 },
    });
    expect((await register(s.auth, w.section.id).expect(422)).body.error.code).toBe(
      'RESTRICTION_NOT_MET',
    );
    await prisma.courseRestriction.deleteMany({ where: { courseId: w.course.id } });
    await prisma.courseRestriction.create({
      data: {
        sectionId: w.section.id,
        mode: 'INCLUDE',
        targetType: 'PROGRAM',
        targetId: w.program.id,
      },
    });
    await register(s.auth, w.section.id).expect(201);
  });
});

describe('concurrency and idempotency', () => {
  it('AC-REG-001: 50 concurrent requests for 1 seat yield exactly one registration', async () => {
    const w = await world();
    await prisma.courseSection.update({ where: { id: w.section.id }, data: { capacity: 1 } });
    const students = await Promise.all(Array.from({ length: 50 }, () => student(w.program.id)));
    const results = await Promise.all(students.map((s) => register(s.auth, w.section.id)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((x) => x === 201)).toHaveLength(1);
    expect(statuses.filter((x) => x === 409)).toHaveLength(49);
    expect(new Set(results.filter((r) => r.status === 409).map((r) => r.body.error.code))).toEqual(
      new Set(['SECTION_FULL']),
    );
    const section = await prisma.courseSection.findUniqueOrThrow({ where: { id: w.section.id } });
    expect(section.enrolledCount).toBe(1);
    expect(await prisma.courseRegistration.count({ where: { sectionId: w.section.id } })).toBe(1);
  }, 60_000);

  it('AC-REG-006: the same idempotency key twice creates one registration', async () => {
    const w = await world();
    const s = await student(w.program.id);
    const key = 'reg-key-0001-abcdef';
    const [a, b] = await Promise.all([
      register(s.auth, w.section.id, {}, key),
      register(s.auth, w.section.id, {}, key),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.data.id).toBe(b.body.data.id);
    expect([a.headers['idempotent-replay'], b.headers['idempotent-replay']]).toContain('true');
    expect(await prisma.courseRegistration.count({ where: { studentId: s.id } })).toBe(1);
    const other = await createSection((await createCourse(w.dept.id)).id, w.session.id, {
      status: 'PUBLISHED',
    });
    expect((await register(s.auth, other.id, {}, key).expect(409)).body.error.code).toBe(
      'CONFLICT',
    );
  });

  it('lets only one of two clashing sections through when submitted together by one student', async () => {
    const w = await world();
    const s = await student(w.program.id);
    const clash = await createSection((await createCourse(w.dept.id)).id, w.session.id, {
      status: 'PUBLISHED',
      meetings: [MON_9],
    });
    const [a, b] = await Promise.all([register(s.auth, w.section.id), register(s.auth, clash.id)]);
    expect([a.status, b.status].sort()).toEqual([201, 422]);
  });
});

describe('waitlist', () => {
  it('AC-REG-005: a drop promotes the first eligible waitlisted student and both are notified', async () => {
    const w = await world();
    await prisma.courseSection.update({ where: { id: w.section.id }, data: { capacity: 1 } });
    const [a, b, c] = await Promise.all([
      student(w.program.id),
      student(w.program.id),
      student(w.program.id),
    ]);
    const seat = await register(a.auth, w.section.id).expect(201);
    expect((await register(b.auth, w.section.id).expect(409)).body.error.details).toMatchObject({
      waitlistAvailable: true,
    });
    const wl = await register(b.auth, w.section.id, { joinWaitlist: true }).expect(201);
    expect(wl.body.data).toMatchObject({ status: 'WAITLISTED', waitlistPosition: 1 });
    expect(
      (await register(c.auth, w.section.id, { joinWaitlist: true }).expect(201)).body.data
        .waitlistPosition,
    ).toBe(2);

    await request(app)
      .post(`${api}/registrations/${seat.body.data.id}/drop`)
      .set(bearer(a.auth))
      .send({})
      .expect(200);
    expect(await promoteSection(w.section.id)).toEqual({ promoted: 1, skipped: 0 });
    const promoted = await prisma.courseRegistration.findUniqueOrThrow({
      where: { id: wl.body.data.id },
    });
    expect(promoted.status).toBe('REGISTERED');
    const section = await prisma.courseSection.findUniqueOrThrow({ where: { id: w.section.id } });
    expect(section).toMatchObject({ enrolledCount: 1, waitlistCount: 1 });
    expect(
      await prisma.notification.count({
        where: { userId: a.userId, title: { startsWith: 'Dropped' } },
      }),
    ).toBe(1);
    expect(
      await prisma.notification.count({
        where: { userId: b.userId, title: { startsWith: 'You are now registered' } },
      }),
    ).toBe(1);
  });

  it('offers seats in OFFER mode; unclaimed offers expire to the next student', async () => {
    const w = await world({ promotionMode: 'OFFER', offerWindowHours: 24 });
    await prisma.courseSection.update({ where: { id: w.section.id }, data: { capacity: 1 } });
    const [a, b, c] = await Promise.all([
      student(w.program.id),
      student(w.program.id),
      student(w.program.id),
    ]);
    const seat = await register(a.auth, w.section.id).expect(201);
    const wb = await register(b.auth, w.section.id, { joinWaitlist: true }).expect(201);
    const wc = await register(c.auth, w.section.id, { joinWaitlist: true }).expect(201);
    await request(app)
      .post(`${api}/registrations/${seat.body.data.id}/drop`)
      .set(bearer(a.auth))
      .send({})
      .expect(200);
    await promoteSection(w.section.id);
    const offered = await prisma.courseRegistration.findUniqueOrThrow({
      where: { id: wb.body.data.id },
    });
    expect(offered.status).toBe('OFFERED');

    await expireOffer(offered.id, new Date(offered.offerExpiresAt!.getTime() + 1000));
    expect(
      (await prisma.courseRegistration.findUniqueOrThrow({ where: { id: offered.id } })).status,
    ).toBe('EXPIRED');
    expect(
      (await prisma.courseRegistration.findUniqueOrThrow({ where: { id: wc.body.data.id } }))
        .status,
    ).toBe('OFFERED');
    await request(app)
      .post(`${api}/registrations/${wc.body.data.id}/claim`)
      .set(bearer(c.auth))
      .expect(200);
    expect(
      (await prisma.courseRegistration.findUniqueOrThrow({ where: { id: wc.body.data.id } }))
        .status,
    ).toBe('REGISTERED');
  });

  it('expires waitlists when the period closes and reconciles drifted counters', async () => {
    const w = await world();
    await prisma.courseSection.update({ where: { id: w.section.id }, data: { capacity: 1 } });
    const [a, b] = await Promise.all([student(w.program.id), student(w.program.id)]);
    await register(a.auth, w.section.id).expect(201);
    await register(b.auth, w.section.id, { joinWaitlist: true }).expect(201);
    expect(await expireClosedWaitlists(new Date(Date.now() + 8 * DAY))).toBe(1);
    expect(
      await prisma.courseRegistration.count({
        where: { sectionId: w.section.id, status: 'EXPIRED' },
      }),
    ).toBe(1);

    await prisma.courseSection.update({
      where: { id: w.section.id },
      data: { enrolledCount: 0, waitlistCount: 3 },
    });
    expect(await reconcileCounters()).toEqual({ fixed: 1 });
    expect(
      await prisma.courseSection.findUniqueOrThrow({ where: { id: w.section.id } }),
    ).toMatchObject({ enrolledCount: 1, waitlistCount: 0 });
  });
});

describe('approvals, corequisites, withdrawal and overrides', () => {
  it('holds a seat pending approval for cross-department students; approve or reject', async () => {
    const w = await world({ approvalMode: 'CROSS_DEPARTMENT' });
    const outsider = await student((await createProgram(w.other.id)).id);
    const outsider2 = await student((await createProgram(w.other.id)).id);
    const pending = await register(outsider.auth, w.section.id).expect(201);
    expect(pending.body.data.status).toBe('PENDING');
    const p2 = await register(outsider2.auth, w.section.id).expect(201);
    expect(
      (await prisma.courseSection.findUniqueOrThrow({ where: { id: w.section.id } })).enrolledCount,
    ).toBe(2);

    const admin = await as('ACADEMIC_ADMIN');
    const approved = await request(app)
      .post(`${api}/registrations/${pending.body.data.id}/decision`)
      .set(bearer(admin))
      .send({ decision: 'APPROVE' })
      .expect(200);
    expect(approved.body.data.status).toBe('REGISTERED');
    await request(app)
      .post(`${api}/registrations/${p2.body.data.id}/decision`)
      .set(bearer(admin))
      .send({ decision: 'REJECT' })
      .expect(400);
    await request(app)
      .post(`${api}/registrations/${p2.body.data.id}/decision`)
      .set(bearer(admin))
      .send({ decision: 'REJECT', note: 'Prerequisite knowledge missing' })
      .expect(200);
    expect(
      (await prisma.courseSection.findUniqueOrThrow({ where: { id: w.section.id } })).enrolledCount,
    ).toBe(1);
    const detail = await request(app)
      .get(`${api}/registrations/${pending.body.data.id}`)
      .set(bearer(outsider.auth))
      .expect(200);
    expect(detail.body.data.history.map((h: { action: string }) => h.action)).toEqual([
      'REQUESTED',
      'APPROVED',
    ]);
  });

  it('enforces corequisites on register and drop; batches satisfy each other', async () => {
    const w = await world();
    const lab = await createCourse(w.dept.id, { code: 'LAB1', credits: 2 });
    await prisma.courseCorequisite.create({
      data: { courseId: lab.id, corequisiteId: w.course.id },
    });
    const labSection = await createSection(lab.id, w.session.id, {
      status: 'PUBLISHED',
      meetings: [{ dayOfWeek: 3, startMinute: 840, endMinute: 960 }],
    });
    const s = await student(w.program.id);
    expect((await register(s.auth, labSection.id).expect(422)).body.error.code).toBe(
      'COREQUISITE_NOT_MET',
    );

    const batch = await request(app)
      .post(`${api}/registrations/batch`)
      .set(bearer(s.auth))
      .send({ items: [{ sectionId: labSection.id }, { sectionId: w.section.id }] })
      .expect(200);
    expect(batch.body.data).toMatchObject({ succeeded: 2, failed: 0 });
    const lecture = batch.body.data.results.find(
      (r: { sectionId: string }) => r.sectionId === w.section.id,
    ).registration;
    const labReg = batch.body.data.results.find(
      (r: { sectionId: string }) => r.sectionId === labSection.id,
    ).registration;

    const blocked = await request(app)
      .post(`${api}/registrations/${lecture.id}/drop`)
      .set(bearer(s.auth))
      .send({})
      .expect(422);
    expect(blocked.body.error).toMatchObject({
      code: 'COREQUISITE_DEPENDENCY',
      details: { dependants: [{ courseCode: 'LAB1' }] },
    });
    const both = await request(app)
      .post(`${api}/registrations/${lecture.id}/drop`)
      .set(bearer(s.auth))
      .send({ alsoDrop: [labReg.id] })
      .expect(200);
    expect(both.body.data.map((r: { status: string }) => r.status)).toEqual(['DROPPED', 'DROPPED']);
  });

  it('withdraws after add/drop, optionally through an approval request', async () => {
    const w = await world({ withdrawalRequiresApproval: true });
    const s = await student(w.program.id);
    const reg = await register(s.auth, w.section.id).expect(201);
    const withdraw = () =>
      request(app)
        .post(`${api}/registrations/${reg.body.data.id}/withdraw`)
        .set(bearer(s.auth))
        .send({ reason: 'Health reasons' });
    expect((await withdraw().expect(422)).body.message).toMatch(/drop the course instead/);
    // Move the window into the past: add/drop over, withdrawal still open.
    await prisma.registrationPeriod.update({
      where: { sessionId: w.session.id },
      data: {
        opensAt: new Date(Date.now() - 30 * DAY),
        closesAt: new Date(Date.now() - 20 * DAY),
        addDropDeadline: new Date(Date.now() - 1000),
      },
    });
    await request(app)
      .post(`${api}/registrations/${reg.body.data.id}/drop`)
      .set(bearer(s.auth))
      .send({})
      .expect(422);
    const requested = await withdraw().expect(200);
    expect(requested.body.data).toMatchObject({
      status: 'REGISTERED',
      pendingRequest: { type: 'WITHDRAWAL' },
    });
    await withdraw().expect(409);

    const admin = await as('ACADEMIC_ADMIN');
    const list = await request(app)
      .get(`${api}/registration-requests?status=PENDING`)
      .set(bearer(admin))
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    const done = await request(app)
      .post(`${api}/registration-requests/${list.body.data[0].id}/decision`)
      .set(bearer(admin))
      .send({ decision: 'APPROVE' })
      .expect(200);
    expect(done.body.data.status).toBe('WITHDRAWN');
  });

  it('admins register on behalf with audited overrides; capacity overrides raise capacity', async () => {
    const w = await world();
    await prisma.courseSection.update({ where: { id: w.section.id }, data: { capacity: 1 } });
    const [a, b] = await Promise.all([student(w.program.id), student(w.program.id)]);
    await register(a.auth, w.section.id).expect(201);
    const deptAdminUser = await createUser();
    await grantScoped(deptAdminUser.id, 'DEPARTMENT_ADMIN', {
      scopeType: 'DEPARTMENT',
      scopeId: w.dept.id,
    });
    const deptAdmin = await login(app, deptAdminUser.email);
    const body = {
      studentId: b.id,
      sectionId: w.section.id,
      overrides: ['CAPACITY'],
      reason: 'Approved by the head of department',
    };
    // Department admins hold registration:manage but not registration:override.
    await request(app)
      .post(`${api}/admin/registrations`)
      .set(bearer(deptAdmin))
      .send(body)
      .expect(403);
    expect(
      (
        await request(app)
          .post(`${api}/admin/registrations`)
          .set(bearer(deptAdmin))
          .send({ ...body, overrides: [] })
          .expect(409)
      ).body.error.code,
    ).toBe('SECTION_FULL');

    const registrar = await as('ACADEMIC_ADMIN');
    await request(app)
      .post(`${api}/admin/registrations`)
      .set(bearer(registrar))
      .send({ ...body, reason: null })
      .expect(400);
    const res = await request(app)
      .post(`${api}/admin/registrations`)
      .set(bearer(registrar))
      .send(body)
      .expect(201);
    expect(res.body.data).toMatchObject({ status: 'REGISTERED', overrides: ['CAPACITY'] });
    expect(
      await prisma.courseSection.findUniqueOrThrow({ where: { id: w.section.id } }),
    ).toMatchObject({ capacity: 2, enrolledCount: 2 });
    expect(
      await prisma.auditLog.count({ where: { action: 'registration.created_with_override' } }),
    ).toBe(1);
  });

  it('cancelling a section cancels its registrations and notifies students (FR-CRS-010)', async () => {
    const w = await world();
    await prisma.courseSection.update({ where: { id: w.section.id }, data: { capacity: 1 } });
    const [a, b] = await Promise.all([student(w.program.id), student(w.program.id)]);
    await register(a.auth, w.section.id).expect(201);
    await register(b.auth, w.section.id, { joinWaitlist: true }).expect(201);
    const registrar = await as('ACADEMIC_ADMIN');
    await request(app)
      .post(`${api}/course-sections/${w.section.id}/transition`)
      .set(bearer(registrar))
      .send({ action: 'cancel', reason: 'Instructor unavailable' })
      .expect(200);
    expect(
      await prisma.courseRegistration.count({
        where: { sectionId: w.section.id, status: 'CANCELLED' },
      }),
    ).toBe(2);
    expect(
      await prisma.courseSection.findUniqueOrThrow({ where: { id: w.section.id } }),
    ).toMatchObject({ enrolledCount: 0, waitlistCount: 0 });
    expect(
      await prisma.notification.count({ where: { title: { endsWith: 'has been cancelled' } } }),
    ).toBe(2);
  });

  it('scopes reads: students see only their own registrations', async () => {
    const w = await world();
    const [a, b] = await Promise.all([student(w.program.id), student(w.program.id)]);
    const reg = await register(a.auth, w.section.id).expect(201);
    await request(app)
      .get(`${api}/registrations/${reg.body.data.id}`)
      .set(bearer(b.auth))
      .expect(404);
    expect(
      (await request(app).get(`${api}/registrations`).set(bearer(b.auth)).expect(200)).body.data,
    ).toHaveLength(0);
    const roster = await request(app)
      .get(`${api}/course-sections/${w.section.id}/registrations`)
      .set(bearer(await as('ACADEMIC_ADMIN')))
      .expect(200);
    expect(roster.body.data.seats).toHaveLength(1);
  });
});
