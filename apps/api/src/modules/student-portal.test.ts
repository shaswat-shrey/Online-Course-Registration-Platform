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
  createProgram,
  createSchool,
  createSection,
  createSession,
  createStudentRecord,
  createUser,
  login,
} from '../tests/factories.js';

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
  const program = await createProgram(dept.id, { totalCredits: 20 });
  const past = await createSession({ status: 'COMPLETED' });
  const session = await createSession();
  await prisma.registrationPeriod.create({
    data: {
      sessionId: session.id,
      opensAt: new Date(Date.now() - DAY),
      closesAt: new Date(Date.now() + 7 * DAY),
      addDropDeadline: new Date(Date.now() + 14 * DAY),
      withdrawalDeadline: new Date(Date.now() + 30 * DAY),
    },
  });
  const intro = await createCourse(dept.id, { code: 'INT101', credits: 4 });
  const advanced = await createCourse(dept.id, { code: 'ADV201', credits: 4 });
  const extra = await createCourse(dept.id, { code: 'EXT301', credits: 3 });
  const draft = await createCourse(dept.id, { code: 'DRF101', status: 'DRAFT' });
  const group = await prisma.prerequisiteGroup.create({
    data: { courseId: advanced.id, position: 0 },
  });
  await prisma.prerequisiteItem.create({ data: { groupId: group.id, requiredCourseId: intro.id } });
  const advSection = await createSection(advanced.id, session.id, {
    status: 'PUBLISHED',
    capacity: 1,
    meetings: [{ dayOfWeek: 2, startMinute: 600, endMinute: 690 }],
  });
  await prisma.courseSection.update({
    where: { id: advSection.id },
    data: { waitlistCapacity: 5 },
  });
  const extraSection = await createSection(extra.id, session.id, {
    status: 'PUBLISHED',
    capacity: 30,
    meetings: [{ dayOfWeek: 4, startMinute: 540, endMinute: 600 }],
  });
  await createSection(intro.id, session.id, { status: 'DRAFT' });
  await createSection(draft.id, session.id, { status: 'PUBLISHED' });
  const pastSection = await createSection(intro.id, past.id, { status: 'COMPLETED' });
  const { user, student } = await createStudentRecord(program.id, { yearOfStudy: 2 });
  return {
    dept,
    program,
    past,
    session,
    intro,
    advanced,
    extra,
    advSection,
    extraSection,
    pastSection,
    student,
    auth: await login(app, user.email),
  };
}

async function complete(w: Awaited<ReturnType<typeof world>>, grade = 'A', points = 9) {
  const reg = await prisma.courseRegistration.create({
    data: {
      studentId: w.student.id,
      sectionId: w.pastSection.id,
      courseId: w.intro.id,
      sessionId: w.past.id,
      status: 'COMPLETED',
      credits: 4,
    },
  });
  await prisma.academicRecord.create({
    data: {
      studentId: w.student.id,
      courseId: w.intro.id,
      sessionId: w.past.id,
      registrationId: reg.id,
      source: 'ENROLLMENT',
      courseCodeSnapshot: 'INT101',
      courseTitleSnapshot: 'Intro',
      creditsAttempted: 4,
      creditsEarned: 4,
      gradeLetter: grade,
      gradePoints: points,
      passed: true,
    },
  });
}

describe('student catalog', () => {
  it('lists active courses with published sections, availability and the student’s status (FR-STUDENT-003)', async () => {
    const w = await world();
    const sessions = await request(app)
      .get(`${api}/catalog/sessions`)
      .set(bearer(w.auth))
      .expect(200);
    expect(
      sessions.body.data.map((s: { id: string; registrationState: string }) => [
        s.id,
        s.registrationState,
      ]),
    ).toEqual([[w.session.id, 'OPEN']]);

    const list = await request(app)
      .get(`${api}/catalog?sessionId=${w.session.id}`)
      .set(bearer(w.auth))
      .expect(200);
    expect(list.body.data.map((c: { code: string }) => c.code)).toEqual(['ADV201', 'EXT301']);

    await prisma.courseRegistration.create({
      data: {
        studentId: (await createStudentRecord(w.program.id)).student.id,
        sectionId: w.advSection.id,
        courseId: w.advanced.id,
        sessionId: w.session.id,
        status: 'REGISTERED',
        credits: 4,
      },
    });
    await prisma.courseSection.update({
      where: { id: w.advSection.id },
      data: { enrolledCount: 1 },
    });
    const open = await request(app)
      .get(`${api}/catalog?sessionId=${w.session.id}&availability=open`)
      .set(bearer(w.auth))
      .expect(200);
    expect(open.body.data.map((c: { code: string }) => c.code)).toEqual(['EXT301']);
    const waitlist = await request(app)
      .get(`${api}/catalog?sessionId=${w.session.id}&availability=waitlist`)
      .set(bearer(w.auth))
      .expect(200);
    expect(waitlist.body.data[0]).toMatchObject({
      code: 'ADV201',
      openSeats: 0,
      waitlistOpen: true,
    });
    const search = await request(app)
      .get(`${api}/catalog?sessionId=${w.session.id}&q=ext3`)
      .set(bearer(w.auth))
      .expect(200);
    expect(search.body.data.map((c: { code: string }) => c.code)).toEqual(['EXT301']);

    const admin = await login(app, (await createUser({ roles: ['ACADEMIC_ADMIN'] })).email);
    await request(app)
      .get(`${api}/catalog?sessionId=${w.session.id}`)
      .set(bearer(admin))
      .expect(403);
  });

  it('shows prerequisites with the student’s own status (FR-STUDENT-004)', async () => {
    const w = await world();
    const before = await request(app)
      .get(`${api}/catalog/courses/${w.advanced.id}?sessionId=${w.session.id}`)
      .set(bearer(w.auth))
      .expect(200);
    expect(before.body.data.prerequisites[0].items[0]).toMatchObject({
      course: { code: 'INT101' },
      state: 'MISSING',
    });
    expect(before.body.data.sections).toHaveLength(1);
    await complete(w);
    const after = await request(app)
      .get(`${api}/catalog/courses/${w.advanced.id}?sessionId=${w.session.id}`)
      .set(bearer(w.auth))
      .expect(200);
    expect(after.body.data.prerequisites[0].items[0]).toMatchObject({
      state: 'COMPLETED',
      grade: 'A',
    });
  });
});

describe('student self-service views', () => {
  it('builds the timetable and an iCalendar export (FR-STUDENT-010)', async () => {
    const w = await world();
    await prisma.courseRegistration.create({
      data: {
        studentId: w.student.id,
        sectionId: w.extraSection.id,
        courseId: w.extra.id,
        sessionId: w.session.id,
        status: 'REGISTERED',
        credits: 3,
      },
    });
    const t = await request(app)
      .get(`${api}/students/me/timetable?sessionId=${w.session.id}`)
      .set(bearer(w.auth))
      .expect(200);
    expect(t.body.data.entries).toEqual([
      expect.objectContaining({ course: 'EXT301', dayOfWeek: 4, startMinute: 540 }),
    ]);
    const ics = await request(app)
      .get(`${api}/students/me/timetable.ics?sessionId=${w.session.id}`)
      .set(bearer(w.auth))
      .expect(200);
    expect(ics.headers['content-type']).toMatch(/text\/calendar/);
    expect(ics.text).toMatch(
      /BEGIN:VEVENT[\s\S]*RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261218T235959Z[\s\S]*END:VEVENT/,
    );
    expect(ics.text).toMatch(/DTSTART;TZID=UTC:20260806T090000/);
  });

  it('reports history with session GPA and CGPA, and degree progress (FR-STUDENT-009/011)', async () => {
    const w = await world();
    await complete(w, 'B', 7);
    await prisma.courseRegistration.create({
      data: {
        studentId: w.student.id,
        sectionId: w.extraSection.id,
        courseId: w.extra.id,
        sessionId: w.session.id,
        status: 'REGISTERED',
        credits: 3,
      },
    });
    const core = await prisma.requirementGroup.create({
      data: { programId: w.program.id, name: 'Core', kind: 'ALL_OF', position: 0 },
    });
    await prisma.requirementCourse.createMany({
      data: [
        { requirementGroupId: core.id, courseId: w.intro.id },
        { requirementGroupId: core.id, courseId: w.advanced.id },
      ],
    });
    await prisma.requirementGroup.create({
      data: {
        programId: w.program.id,
        name: 'Free',
        kind: 'CREDITS_ANY',
        minCredits: 6,
        position: 1,
      },
    });

    const h = await request(app).get(`${api}/students/me/history`).set(bearer(w.auth)).expect(200);
    expect(h.body.data).toMatchObject({
      creditsEarned: 4,
      cgpa: 7,
      sessions: [{ gpa: 7, courses: [{ code: 'INT101', grade: 'B' }] }],
    });

    const p = await request(app).get(`${api}/students/me/progress`).set(bearer(w.auth)).expect(200);
    expect(p.body.data).toMatchObject({
      totalRequired: 20,
      completed: 4,
      inProgress: 3,
      remaining: 13,
    });
    const [coreGroup, free] = p.body.data.groups;
    expect(coreGroup).toMatchObject({
      name: 'Core',
      requiredCredits: 8,
      completedCredits: 4,
      satisfied: false,
    });
    expect(
      coreGroup.courses.map((c: { code: string; state: string }) => [c.code, c.state]),
    ).toEqual([
      ['INT101', 'COMPLETED'],
      ['ADV201', 'PENDING'],
    ]);
    // INT101 already counted towards Core, so the free group sees only EXT301 (in progress).
    expect(free).toMatchObject({ requiredCredits: 6, completedCredits: 0, inProgressCredits: 3 });
  });

  it('summarises the dashboard and keeps registered sections visible after they close', async () => {
    const w = await world();
    await prisma.courseSection.update({
      where: { id: w.advSection.id },
      data: { enrolledCount: 1 },
    });
    const wl = await prisma.courseRegistration.create({
      data: {
        studentId: w.student.id,
        sectionId: w.advSection.id,
        courseId: w.advanced.id,
        sessionId: w.session.id,
        status: 'WAITLISTED',
        credits: 4,
        waitlistedAt: new Date(),
      },
    });
    const reg = await prisma.courseRegistration.create({
      data: {
        studentId: w.student.id,
        sectionId: w.extraSection.id,
        courseId: w.extra.id,
        sessionId: w.session.id,
        status: 'REGISTERED',
        credits: 3,
      },
    });
    const d = await request(app)
      .get(`${api}/students/me/dashboard`)
      .set(bearer(w.auth))
      .expect(200);
    expect(d.body.data.currentSession).toMatchObject({ registrationState: 'OPEN', credits: 3 });
    expect(d.body.data.pending.map((p: { id: string }) => p.id)).toEqual([wl.id]);
    expect(d.body.data.profile).toMatchObject({ yearOfStudy: 2, activeHolds: 0 });

    await prisma.courseSection.update({
      where: { id: w.extraSection.id },
      data: { status: 'CLOSED' },
    });
    await request(app)
      .get(`${api}/course-sections/${w.extraSection.id}`)
      .set(bearer(w.auth))
      .expect(200);
    const other = await login(app, (await createStudentRecord(w.program.id)).user.email);
    await request(app)
      .get(`${api}/course-sections/${w.extraSection.id}`)
      .set(bearer(other))
      .expect(404);
    expect(reg.id).toBeTruthy();
  });
});
