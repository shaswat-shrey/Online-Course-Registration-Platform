import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { RoleKey } from '@ucrams/shared';
import { createApp } from '../app.js';
import { prisma } from '../infrastructure/database/prisma.js';
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
  createUser,
  grantScoped,
  login,
} from '../tests/factories.js';

const app = createApp();
const api = '/api/v1';

beforeEach(resetState);
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
});

async function as(role: RoleKey) {
  const user = await createUser({ roles: [role] });
  return { ...(await login(app, user.email)), userId: user.id };
}
async function deptAdmin(departmentId: string) {
  const user = await createUser();
  await grantScoped(user.id, 'DEPARTMENT_ADMIN', {
    scopeType: 'DEPARTMENT',
    scopeId: departmentId,
  });
  return login(app, user.email);
}
async function fixture() {
  const school = await createSchool();
  const cs = await createDepartment(school.id);
  const me = await createDepartment(school.id);
  return { school, cs, me };
}
const MON_9 = { dayOfWeek: 1, startMinute: 540, endMinute: 600 };

describe('courses', () => {
  it('creates courses in scope, normalises codes and rejects duplicates', async () => {
    const { cs, me } = await fixture();
    const admin = await deptAdmin(cs.id);
    const body = {
      code: 'cs101',
      title: 'Programming Fundamentals',
      departmentId: cs.id,
      credits: 4,
      level: 100,
      category: 'CORE',
      outcomes: ['Write programs'],
      assessmentComponents: [{ name: 'Exam', weight: 60 }],
    };

    const res = await request(app).post(`${api}/courses`).set(bearer(admin)).send(body).expect(201);
    expect(res.body.data).toMatchObject({
      code: 'CS101',
      status: 'DRAFT',
      canManage: true,
      outcomes: ['Write programs'],
    });
    expect(res.body.data.assessmentComponents).toEqual([{ name: 'Exam', weight: 60 }]);

    const dup = await request(app).post(`${api}/courses`).set(bearer(admin)).send(body).expect(409);
    expect(dup.body.error.details.fields[0].path).toBe('body.code');
    // Department admins cannot create courses in another department.
    await request(app)
      .post(`${api}/courses`)
      .set(bearer(admin))
      .send({ ...body, code: 'ME101', departmentId: me.id })
      .expect(403);
    const audit = await prisma.auditLog.count({ where: { action: 'course.created' } });
    expect(audit).toBe(1);
  });

  it('shows only active courses to students, searches by text and filters', async () => {
    const { cs } = await fixture();
    const algo = await prisma.course.create({
      data: {
        code: 'CS301',
        title: 'Design and Analysis of Algorithms',
        description: 'Greedy methods and dynamic programming',
        departmentId: cs.id,
        credits: 4,
        level: 300,
        category: 'CORE',
        status: 'ACTIVE',
      },
    });
    const draft = await createCourse(cs.id, { status: 'DRAFT', code: 'CS999' });
    const student = await as('STUDENT');
    const registrar = await as('ACADEMIC_ADMIN');

    const list = await request(app).get(`${api}/courses`).set(bearer(student)).expect(200);
    expect(list.body.data.map((c: { code: string }) => c.code)).toEqual(['CS301']);
    await request(app).get(`${api}/courses/${draft.id}`).set(bearer(student)).expect(404);
    await request(app).get(`${api}/courses/${draft.id}`).set(bearer(registrar)).expect(200);

    const byText = await request(app)
      .get(`${api}/courses?q=dynamic programming`)
      .set(bearer(student))
      .expect(200);
    expect(byText.body.data[0].id).toBe(algo.id);
    const byCode = await request(app).get(`${api}/courses?q=cs3`).set(bearer(student)).expect(200);
    expect(byCode.body.data[0].code).toBe('CS301');
    const byLevel = await request(app)
      .get(`${api}/courses?level=100`)
      .set(bearer(registrar))
      .expect(200);
    expect(byLevel.body.data.map((c: { code: string }) => c.code)).toEqual(['CS999']);
  });

  it('saves AND-of-OR prerequisites and rejects self references and cycles (BR-007)', async () => {
    const { cs } = await fixture();
    const [a, b, c, d] = await Promise.all(
      ['A1', 'B1', 'C1', 'D1'].map((code) => createCourse(cs.id, { code })),
    );
    const registrar = await as('ACADEMIC_ADMIN');
    const put = (courseId: string, groups: unknown) =>
      request(app)
        .put(`${api}/courses/${courseId}/prerequisites`)
        .set(bearer(registrar))
        .send({ groups });

    // C requires (A or B) and D, with a minimum grade on A.
    const ok = await put(c!.id, [
      { items: [{ courseId: a!.id, minGradeLetter: 'c' }, { courseId: b!.id }] },
      { items: [{ courseId: d!.id }] },
    ]).expect(200);
    expect(ok.body.data.prerequisites).toHaveLength(2);
    expect(ok.body.data.prerequisites[0].items[0]).toMatchObject({
      course: { code: 'A1' },
      minGradeLetter: 'C',
    });

    await put(a!.id, [{ items: [{ courseId: a!.id }] }]).expect(422);
    // A requires C would close the loop C → A → C.
    const cycle = await put(a!.id, [{ items: [{ courseId: c!.id }] }]).expect(409);
    expect(cycle.body.error.code).toBe('PREREQUISITE_CYCLE');
    expect(cycle.body.error.details.cycle).toEqual(['A1', 'C1', 'A1']);
    // A longer path: D requires C (C → D → C).
    expect((await put(d!.id, [{ items: [{ courseId: c!.id }] }]).expect(409)).body.error.code).toBe(
      'PREREQUISITE_CYCLE',
    );

    const coreq = await request(app)
      .put(`${api}/courses/${c!.id}/corequisites`)
      .set(bearer(registrar))
      .send({ courseIds: [a!.id] })
      .expect(422);
    expect(coreq.body.message).toMatch(/both a prerequisite and a corequisite/);
  });

  it('enforces status transitions and blocks deactivation with published sections', async () => {
    const { cs } = await fixture();
    const session = await createSession();
    const draft = await createCourse(cs.id, { status: 'DRAFT' });
    const admin = await deptAdmin(cs.id);
    const patch = (id: string, body: object) =>
      request(app).patch(`${api}/courses/${id}`).set(bearer(admin)).send(body);

    await patch(draft.id, { status: 'ACTIVE' }).expect(200);
    expect((await patch(draft.id, { status: 'DRAFT' }).expect(422)).body.error.code).toBe(
      'INVALID_STATE_TRANSITION',
    );
    await createSection(draft.id, session.id, { status: 'PUBLISHED' });
    const blocked = await patch(draft.id, { status: 'INACTIVE' }).expect(422);
    expect(blocked.body.error.details.openSections).toBe(1);
  });

  it('deletes only unreferenced drafts', async () => {
    const { cs } = await fixture();
    const registrar = await as('ACADEMIC_ADMIN');
    const active = await createCourse(cs.id);
    const draft = await createCourse(cs.id, { status: 'DRAFT' });
    const user = await createCourse(cs.id, { status: 'DRAFT' });
    await request(app)
      .put(`${api}/courses/${user.id}/prerequisites`)
      .set(bearer(registrar))
      .send({ groups: [{ items: [{ courseId: draft.id }] }] })
      .expect(200);

    await request(app).delete(`${api}/courses/${active.id}`).set(bearer(registrar)).expect(422);
    const referenced = await request(app)
      .delete(`${api}/courses/${draft.id}`)
      .set(bearer(registrar))
      .expect(422);
    expect(referenced.body.error.details.prerequisiteOf).toBe(1);
    await request(app).delete(`${api}/courses/${user.id}`).set(bearer(registrar)).expect(200);
  });

  it('maps programs, restrictions and requirement-group course lists', async () => {
    const { cs } = await fixture();
    const program = await createProgram(cs.id);
    const course = await createCourse(cs.id);
    const draft = await createCourse(cs.id, { status: 'DRAFT' });
    const registrar = await as('ACADEMIC_ADMIN');

    const mapped = await request(app)
      .put(`${api}/courses/${course.id}/programs`)
      .set(bearer(registrar))
      .send({ mappings: [{ programId: program.id, mappingType: 'CORE' }] })
      .expect(200);
    expect(mapped.body.data.programs[0]).toMatchObject({ code: program.code, mappingType: 'CORE' });

    const restricted = await request(app)
      .put(`${api}/courses/${course.id}/restrictions`)
      .set(bearer(registrar))
      .send({
        restrictions: [
          { mode: 'INCLUDE', targetType: 'PROGRAM', targetId: program.id },
          { mode: 'EXCLUDE', targetType: 'YEAR_OF_STUDY', targetValue: 1 },
        ],
      })
      .expect(200);
    expect(restricted.body.data.restrictions.map((r: { label: string }) => r.label)).toEqual([
      `${program.name} (${program.code})`,
      'Year 1',
    ]);

    const group = await prisma.requirementGroup.create({
      data: { programId: program.id, name: 'Core', kind: 'ALL_OF' },
    });
    const any = await prisma.requirementGroup.create({
      data: { programId: program.id, name: 'Free', kind: 'CREDITS_ANY', minCredits: 12 },
    });
    const put = (id: string, courseIds: string[]) =>
      request(app)
        .put(`${api}/requirement-groups/${id}/courses`)
        .set(bearer(registrar))
        .send({ courseIds });
    expect(
      (await put(group.id, [course.id]).expect(200)).body.data.map((c: { id: string }) => c.id),
    ).toEqual([course.id]);
    await put(group.id, [draft.id]).expect(422);
    await put(any.id, [course.id]).expect(422);
    const detail = await request(app)
      .get(`${api}/programs/${program.id}`)
      .set(bearer(registrar))
      .expect(200);
    expect(
      detail.body.data.requirementGroups.find((g: { id: string }) => g.id === group.id).courses,
    ).toHaveLength(1);
  });
});

describe('classrooms', () => {
  it('lets academic admins manage rooms and rejects duplicates', async () => {
    const campus = await prisma.campus.create({ data: { code: 'MAIN', name: 'Main' } });
    const registrar = await as('ACADEMIC_ADMIN');
    const body = {
      campusId: campus.id,
      building: 'Block A',
      roomNumber: 'A-101',
      capacity: 60,
      type: 'CLASSROOM',
      equipment: ['Projector', 'Projector'],
    };
    const res = await request(app)
      .post(`${api}/classrooms`)
      .set(bearer(registrar))
      .send(body)
      .expect(201);
    expect(res.body.data).toMatchObject({ label: 'Block A A-101', equipment: ['Projector'] });
    await request(app)
      .post(`${api}/classrooms`)
      .set(bearer(registrar))
      .send({ ...body, roomNumber: 'a-101' })
      .expect(409);
    const { cs } = await fixture();
    await request(app)
      .post(`${api}/classrooms`)
      .set(bearer(await deptAdmin(cs.id)))
      .send({ ...body, roomNumber: 'A-102' })
      .expect(403);
  });
});

describe('sections', () => {
  async function scheduled() {
    const f = await fixture();
    const session = await createSession();
    const room = await createClassroom({ capacity: 30 });
    const course = await createCourse(f.cs.id, { credits: 4 });
    const other = await createCourse(f.cs.id, { credits: 4 });
    return { ...f, session, room, course, other };
  }

  it('creates sections with unique codes in schedulable sessions only', async () => {
    const { cs, course } = await scheduled();
    const session = await createSession();
    const completed = await createSession({ status: 'COMPLETED' });
    const admin = await deptAdmin(cs.id);
    const body = {
      courseId: course.id,
      sessionId: session.id,
      sectionCode: 'a',
      capacity: 40,
      waitlistCapacity: 5,
    };
    const res = await request(app)
      .post(`${api}/course-sections`)
      .set(bearer(admin))
      .send(body)
      .expect(201);
    expect(res.body.data).toMatchObject({
      sectionCode: 'A',
      status: 'DRAFT',
      availableSeats: 40,
      permissions: { update: true, overrideConflicts: false },
    });
    await request(app).post(`${api}/course-sections`).set(bearer(admin)).send(body).expect(409);
    await request(app)
      .post(`${api}/course-sections`)
      .set(bearer(admin))
      .send({ ...body, sessionId: completed.id, sectionCode: 'B' })
      .expect(422);
  });

  it('blocks classroom conflicts unless overridden with permission and a reason (FR-CRS-007)', async () => {
    const { cs, session, room, course, other } = await scheduled();
    await createSection(other.id, session.id, { meetings: [{ ...MON_9, classroomId: room.id }] });
    const mine = await createSection(course.id, session.id);
    const admin = await deptAdmin(cs.id);
    const registrar = await as('ACADEMIC_ADMIN');
    const put = (who: { accessToken: string }, body: object) =>
      request(app).put(`${api}/course-sections/${mine.id}/meetings`).set(bearer(who)).send(body);
    const clash = {
      meetings: [{ dayOfWeek: 1, startMinute: 570, endMinute: 630, classroomId: room.id }],
    };

    const res = await put(admin, clash).expect(409);
    expect(res.body.error.code).toBe('CLASSROOM_CONFLICT');
    expect(res.body.error.details).toMatchObject({
      canOverride: false,
      conflicts: [{ kind: 'CLASSROOM', section: { courseCode: other.code } }],
    });
    await put(admin, { ...clash, override: { reason: 'Shared exam slot' } }).expect(403);

    const ok = await put(registrar, { ...clash, override: { reason: 'Shared exam slot' } }).expect(
      200,
    );
    expect(ok.body.data.overriddenConflicts).toHaveLength(1);
    // Room seats 30 < section capacity 40.
    expect(ok.body.data.warnings[0]).toMatch(/seats 30/);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'section.meetings_set_with_override' },
    });
    expect(audit.changes).toMatchObject({ overrideReason: 'Shared exam slot' });

    // Back-to-back is not a conflict (BR-018).
    await put(admin, {
      meetings: [{ dayOfWeek: 1, startMinute: 600, endMinute: 660, classroomId: room.id }],
    }).expect(200);
  });

  it('warns about instructor conflicts and load, and accepts an override reason (FR-CRS-008)', async () => {
    const { cs, session, course, other } = await scheduled();
    const { member } = await createFacultyRecord(cs.id);
    await prisma.facultyMember.update({ where: { id: member.id }, data: { maxLoadCredits: 6 } });
    await createSection(other.id, session.id, { meetings: [MON_9], instructorId: member.id });
    const mine = await createSection(course.id, session.id, { meetings: [MON_9] });
    const admin = await deptAdmin(cs.id);
    const put = (body: object) =>
      request(app)
        .put(`${api}/course-sections/${mine.id}/instructors`)
        .set(bearer(admin))
        .send(body);
    const body = { instructors: [{ facultyMemberId: member.id, role: 'PRIMARY' }] };

    const clash = await put(body).expect(409);
    expect(clash.body.error).toMatchObject({
      code: 'INSTRUCTOR_CONFLICT',
      details: { canOverride: true },
    });
    const ok = await put({ ...body, override: { reason: 'Team-taught combined lecture' } }).expect(
      200,
    );
    expect(ok.body.data.instructors[0]).toMatchObject({
      facultyMemberId: member.id,
      role: 'PRIMARY',
    });
    expect(ok.body.data.warnings[0]).toMatch(/8 credits, above their limit of 6/);
  });

  it('serialises concurrent schedule writes so a room cannot be double-booked', async () => {
    const { session, room, course, other } = await scheduled();
    const a = await createSection(course.id, session.id);
    const b = await createSection(other.id, session.id);
    const registrar = await as('ACADEMIC_ADMIN');
    const body = { meetings: [{ ...MON_9, classroomId: room.id }] };
    const results = await Promise.all(
      [a, b].map((s) =>
        request(app)
          .put(`${api}/course-sections/${s.id}/meetings`)
          .set(bearer(registrar))
          .send(body),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('publishes only with a primary instructor unless permitted (BR-014), and requires an active course', async () => {
    const { cs, session, course } = await scheduled();
    const draftCourse = await createCourse(cs.id, { status: 'DRAFT' });
    const s = await createSection(course.id, session.id);
    const d = await createSection(draftCourse.id, session.id);
    const admin = await deptAdmin(cs.id);
    const registrar = await as('ACADEMIC_ADMIN');
    const act = (who: { accessToken: string }, id: string, body: object) =>
      request(app).post(`${api}/course-sections/${id}/transition`).set(bearer(who)).send(body);

    const res = await act(admin, s.id, { action: 'publish' }).expect(422);
    expect(res.body.error.details.missing).toBe('primaryInstructor');
    expect((await act(registrar, s.id, { action: 'publish' }).expect(200)).body.data.status).toBe(
      'PUBLISHED',
    );
    expect((await act(registrar, d.id, { action: 'publish' }).expect(422)).body.message).toMatch(
      /Activate the course/,
    );
    await act(registrar, s.id, { action: 'close' }).expect(200);
    await act(registrar, s.id, { action: 'reopen' }).expect(200);
    await act(registrar, s.id, { action: 'cancel' }).expect(400);
    const cancelled = await act(registrar, s.id, {
      action: 'cancel',
      reason: 'Low enrollment',
    }).expect(200);
    expect(cancelled.body.data).toMatchObject({
      status: 'CANCELLED',
      registrationOpen: false,
      cancelReason: 'Low enrollment',
    });
    await request(app)
      .patch(`${api}/course-sections/${s.id}`)
      .set(bearer(registrar))
      .send({ capacity: 50 })
      .expect(422);
    await act(registrar, s.id, { action: 'reopen' }).expect(422);
  });

  it('rejects capacity below current enrollment (BR-004)', async () => {
    const { session, course } = await scheduled();
    const s = await createSection(course.id, session.id, { capacity: 40 });
    await prisma.courseSection.update({ where: { id: s.id }, data: { enrolledCount: 30 } });
    const registrar = await as('ACADEMIC_ADMIN');
    const res = await request(app)
      .patch(`${api}/course-sections/${s.id}`)
      .set(bearer(registrar))
      .send({ capacity: 25 })
      .expect(422);
    expect(res.body.error).toMatchObject({
      code: 'CAPACITY_BELOW_ENROLLMENT',
      details: { enrolled: 30 },
    });
    await request(app)
      .patch(`${api}/course-sections/${s.id}`)
      .set(bearer(registrar))
      .send({ capacity: 30 })
      .expect(200);
  });

  it('shows students only published sections and faculty their own drafts (FR-CRS-006)', async () => {
    const { cs, session, course, other } = await scheduled();
    const { user, member } = await createFacultyRecord(cs.id);
    const published = await createSection(course.id, session.id, { status: 'PUBLISHED' });
    const teaching = await createSection(other.id, session.id, { instructorId: member.id });
    await createSection(other.id, session.id, { sectionCode: 'B' });
    const ids = async (who: { accessToken: string }) =>
      (
        await request(app)
          .get(`${api}/course-sections?sessionId=${session.id}`)
          .set(bearer(who))
          .expect(200)
      ).body.data
        .map((s: { id: string }) => s.id)
        .sort();

    expect(await ids(await as('STUDENT'))).toEqual([published.id]);
    expect(await ids(await login(app, user.email))).toEqual([published.id, teaching.id].sort());
    expect(await ids(await as('ACADEMIC_ADMIN'))).toHaveLength(3);
    await request(app)
      .get(`${api}/course-sections/${teaching.id}`)
      .set(bearer(await as('STUDENT')))
      .expect(404);

    const schedule = await request(app)
      .get(`${api}/faculty/${member.id}/schedule?sessionId=${session.id}`)
      .set(bearer(await login(app, user.email)))
      .expect(200);
    expect(schedule.body.data).toMatchObject({
      totalCredits: 4,
      sections: [{ id: teaching.id, role: 'PRIMARY' }],
    });
    await request(app)
      .get(`${api}/faculty/${member.id}/schedule?sessionId=${session.id}`)
      .set(bearer(await as('STUDENT')))
      .expect(403);
  });

  it('rolls sections forward as drafts with meetings and instructors (FR-CRS-011)', async () => {
    const { cs, session, room, course, other } = await scheduled();
    const inactive = await createCourse(cs.id, { status: 'INACTIVE' });
    const { member } = await createFacultyRecord(cs.id);
    await createSection(course.id, session.id, {
      status: 'PUBLISHED',
      meetings: [{ ...MON_9, classroomId: room.id }],
      instructorId: member.id,
    });
    await createSection(other.id, session.id, { status: 'CANCELLED' });
    await createSection(inactive.id, session.id, { status: 'PUBLISHED' });
    const next = await createSession({ status: 'PLANNED' });
    await createSection(course.id, next.id, { sectionCode: 'B' });
    const registrar = await as('ACADEMIC_ADMIN');

    const res = await request(app)
      .post(`${api}/course-sections/roll-forward`)
      .set(bearer(registrar))
      .send({ fromSessionId: session.id, toSessionId: next.id })
      .expect(200);
    expect(res.body.data.created).toHaveLength(1);
    expect(res.body.data.skipped).toEqual([
      { course: inactive.code, sectionCode: 'A', reason: 'Course is not active' },
    ]);
    const copy = await prisma.courseSection.findUniqueOrThrow({
      where: { id: res.body.data.created[0].id },
      include: { meetings: true, instructors: true },
    });
    expect(copy).toMatchObject({ status: 'DRAFT', sessionId: next.id, enrolledCount: 0 });
    expect(copy.meetings[0]).toMatchObject({ ...MON_9, classroomId: room.id });
    expect(copy.instructors[0]).toMatchObject({ facultyMemberId: member.id, role: 'PRIMARY' });

    const again = await request(app)
      .post(`${api}/course-sections/roll-forward`)
      .set(bearer(registrar))
      .send({ fromSessionId: session.id, toSessionId: next.id })
      .expect(200);
    expect(again.body.data.created).toHaveLength(0);
  });

  it('blocks publishing a clashing schedule until the conflict is overridden', async () => {
    const { session, room, course, other } = await scheduled();
    const { member } = await createFacultyRecord(
      (await prisma.course.findUniqueOrThrow({ where: { id: course.id } })).departmentId,
    );
    const next = await createSession({ status: 'PLANNED' });
    // The target session already uses the room at the time the copied section needs it.
    await createSection(other.id, next.id, {
      status: 'PUBLISHED',
      meetings: [{ ...MON_9, classroomId: room.id }],
    });
    await createSection(course.id, session.id, {
      status: 'PUBLISHED',
      meetings: [{ ...MON_9, classroomId: room.id }],
      instructorId: member.id,
    });
    const registrar = await as('ACADEMIC_ADMIN');

    const rolled = await request(app)
      .post(`${api}/course-sections/roll-forward`)
      .set(bearer(registrar))
      .send({ fromSessionId: session.id, toSessionId: next.id })
      .expect(200);
    expect(rolled.body.data).toMatchObject({ withConflicts: 1 });
    const copyId = rolled.body.data.created[0].id;
    const publish = () =>
      request(app)
        .post(`${api}/course-sections/${copyId}/transition`)
        .set(bearer(registrar))
        .send({ action: 'publish' });

    const blocked = await publish().expect(409);
    expect(blocked.body.error).toMatchObject({
      code: 'CLASSROOM_CONFLICT',
      details: { canOverride: false },
    });

    const meetings = { meetings: [{ ...MON_9, classroomId: room.id }] };
    await request(app)
      .put(`${api}/course-sections/${copyId}/meetings`)
      .set(bearer(registrar))
      .send({ ...meetings, override: { reason: 'Room shared by joint lecture' } })
      .expect(200);
    const published = await publish().expect(200);
    expect(published.body.data).toMatchObject({
      status: 'PUBLISHED',
      scheduleOverrideReason: 'Room shared by joint lecture',
    });

    // Moving to a free slot clears the recorded override.
    const cleared = await request(app)
      .put(`${api}/course-sections/${copyId}/meetings`)
      .set(bearer(registrar))
      .send({
        meetings: [{ dayOfWeek: 2, startMinute: 540, endMinute: 600, classroomId: room.id }],
      })
      .expect(200);
    expect(cleared.body.data.scheduleOverrideReason).toBeNull();
  });
});
