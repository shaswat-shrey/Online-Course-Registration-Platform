import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
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
  createStudentRecord,
  createUser,
  grantScoped,
  login,
} from '../tests/factories.js';
import { supersededAttempts } from './academics/transcript.service.js';

const app = createApp();
const api = '/api/v1';

beforeEach(resetState);
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
});

async function world() {
  const school = await createSchool();
  const dept = await createDepartment(school.id);
  const otherDept = await createDepartment(school.id);
  const program = await createProgram(dept.id);
  const scale = await prisma.gradingScale.create({
    data: {
      name: `Scale ${Date.now()}`,
      entries: {
        create: [
          { letter: 'A', minPercent: 85, gradePoints: 10, isPassing: true, position: 0 },
          { letter: 'B', minPercent: 70, gradePoints: 8, isPassing: true, position: 1 },
          { letter: 'C', minPercent: 50, gradePoints: 6, isPassing: true, position: 2 },
          { letter: 'F', minPercent: 0, gradePoints: 0, isPassing: false, position: 3 },
        ],
      },
    },
  });
  const session = await createSession({ status: 'ACTIVE' });
  await prisma.academicSession.update({
    where: { id: session.id },
    data: { gradingScaleId: scale.id },
  });
  const course = await createCourse(dept.id, { code: 'ACA101', credits: 4 });
  const teacher = await createFacultyRecord(dept.id);
  const assistant = await createFacultyRecord(dept.id);
  const room = await createClassroom({ capacity: 60 });
  const section = await createSection(course.id, session.id, {
    status: 'PUBLISHED',
    instructorId: teacher.member.id,
    meetings: [{ dayOfWeek: 1, startMinute: 600, endMinute: 690, classroomId: room.id }],
  });
  await prisma.sectionInstructor.create({
    data: { sectionId: section.id, facultyMemberId: assistant.member.id, role: 'SECONDARY' },
  });
  const students = await Promise.all([1, 2].map(() => createStudentRecord(program.id)));
  const regs = [];
  for (const s of students)
    regs.push(
      await prisma.courseRegistration.create({
        data: {
          studentId: s.student.id,
          sectionId: section.id,
          courseId: course.id,
          sessionId: session.id,
          status: 'REGISTERED',
          credits: 4,
        },
      }),
    );
  await prisma.courseSection.update({ where: { id: section.id }, data: { enrolledCount: 2 } });
  const outsider = await createStudentRecord(program.id);
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
  const registrar = await createUser({ roles: ['ACADEMIC_ADMIN'] });
  const auth = async (email: string) => login(app, email);
  return {
    session,
    course,
    section,
    room,
    students,
    regs,
    teacher: await auth(teacher.user.email),
    assistant: await auth(assistant.user.email),
    s1: await auth(students[0]!.user.email),
    s2: await auth(students[1]!.user.email),
    outsider: await auth(outsider.user.email),
    deptAdmin: await auth(deptAdmin.email),
    otherAdmin: await auth(otherAdmin.email),
    registrar: await auth(registrar.email),
  };
}
type World = Awaited<ReturnType<typeof world>>;

describe('attendance (FR-ACAD-003)', () => {
  it('records classes, computes percentages and shows students their own record', async () => {
    const w = await world();
    const [a, b] = w.students.map((s) => s.student.id);
    const add = (date: string) =>
      request(app)
        .post(`${api}/course-sections/${w.section.id}/attendance-sessions`)
        .set(bearer(w.teacher))
        .send({ date, startMinute: 600, topic: 'Lecture' });
    const first = (await add('2026-08-10').expect(201)).body.data.id;
    const second = (await add('2026-08-17').expect(201)).body.data.id;
    await add('2026-08-10').expect(409);
    await add('2030-01-01').expect(422);
    await request(app)
      .post(`${api}/course-sections/${w.section.id}/attendance-sessions`)
      .set(bearer(w.s1))
      .send({ date: '2026-08-24' })
      .expect(403);

    const mark = (id: string, records: object[]) =>
      request(app)
        .put(`${api}/attendance-sessions/${id}/records`)
        .set(bearer(w.assistant))
        .send({ records });
    await mark(first, [
      { studentId: a, status: 'PRESENT' },
      { studentId: b, status: 'ABSENT' },
    ]).expect(200);
    await mark(second, [
      { studentId: a, status: 'LATE' },
      { studentId: b, status: 'EXCUSED' },
    ]).expect(200);
    const stranger = (
      await prisma.student.findFirstOrThrow({ where: { NOT: { id: { in: [a!, b!] } } } })
    ).id;
    await mark(first, [{ studentId: stranger, status: 'PRESENT' }]).expect(422);

    const reg = await request(app)
      .get(`${api}/course-sections/${w.section.id}/attendance`)
      .set(bearer(w.teacher))
      .expect(200);
    expect(
      reg.body.data.students.map((s: { studentId: string; percent: number }) => [
        s.studentId,
        s.percent,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [a, 100],
        [b, 0],
      ]),
    );

    const roster = await request(app)
      .get(`${api}/course-sections/${w.section.id}/roster`)
      .set(bearer(w.teacher))
      .expect(200);
    expect(
      roster.body.data.find((r: { student: { id: string } }) => r.student.id === a)
        .attendancePercent,
    ).toBe(100);

    const mine = await request(app)
      .get(`${api}/course-sections/${w.section.id}/my-attendance`)
      .set(bearer(w.s2))
      .expect(200);
    expect(mine.body.data).toMatchObject({
      percent: 0,
      sessions: [{ status: 'ABSENT' }, { status: 'EXCUSED' }],
    });
    await request(app)
      .get(`${api}/course-sections/${w.section.id}/my-attendance`)
      .set(bearer(w.outsider))
      .expect(404);

    await request(app)
      .put(`${api}/course-sections/${w.section.id}/attendance/settings`)
      .set(bearer(w.teacher))
      .send({ enabled: false })
      .expect(200);
    await add('2026-08-31').expect(422);
  });
});

async function gradebookWith(w: World) {
  const create = (body: object) =>
    request(app)
      .post(`${api}/course-sections/${w.section.id}/assessments`)
      .set(bearer(w.teacher))
      .send(body);
  const quiz = (
    await create({ title: 'Quiz 1', type: 'QUIZ', weight: 40, maxScore: 20 }).expect(201)
  ).body.data;
  await create({ title: 'Too heavy', type: 'EXAM', weight: 70, maxScore: 100 }).expect(422);
  const exam = (
    await create({ title: 'Final exam', type: 'EXAM', weight: 60, maxScore: 100 }).expect(201)
  ).body.data;
  const [a, b] = w.students.map((s) => s.student.id);
  const score = (id: string, scores: object[]) =>
    request(app).put(`${api}/assessments/${id}/scores`).set(bearer(w.teacher)).send({ scores });
  await score(quiz.id, [{ studentId: a, score: 25 }]).expect(422);
  await score(quiz.id, [
    { studentId: a, score: 18 },
    { studentId: b, score: 10 },
  ]).expect(200);
  await score(exam.id, [
    { studentId: a, score: 90 },
    { studentId: b, score: 40 },
  ]).expect(200);
  return { quiz, exam, a: a!, b: b! };
}

describe('assessments (FR-ACAD-004)', () => {
  it('keeps weights within 100 %, validates scores and publishes to students', async () => {
    const w = await world();
    const { quiz, a, b } = await gradebookWith(w);

    const book = await request(app)
      .get(`${api}/course-sections/${w.section.id}/gradebook`)
      .set(bearer(w.teacher))
      .expect(200);
    expect(book.body.data.totalWeight).toBe(100);
    const percent = (id: string) =>
      book.body.data.students.find((s: { studentId: string }) => s.studentId === id).percent;
    // a: 18/20·40 + 90/100·60 = 36 + 54; b: 20 + 24.
    expect([percent(a), percent(b)]).toEqual([90, 44]);

    const before = await request(app)
      .get(`${api}/course-sections/${w.section.id}/my-assessments`)
      .set(bearer(w.s1))
      .expect(200);
    expect(before.body.data).toEqual({ items: [], percent: null });

    await request(app)
      .patch(`${api}/assessments/${quiz.id}`)
      .set(bearer(w.teacher))
      .send({ published: true })
      .expect(200);
    const after = await request(app)
      .get(`${api}/course-sections/${w.section.id}/my-assessments`)
      .set(bearer(w.s1))
      .expect(200);
    expect(after.body.data).toMatchObject({ items: [{ title: 'Quiz 1', score: 18 }], percent: 90 });
    expect(
      await prisma.notification.count({
        where: { userId: w.students[0]!.user.id, category: 'GRADES' },
      }),
    ).toBe(1);
    await request(app)
      .patch(`${api}/assessments/${quiz.id}`)
      .set(bearer(w.teacher))
      .send({ maxScore: 15 })
      .expect(422);
    await request(app)
      .get(`${api}/course-sections/${w.section.id}/gradebook`)
      .set(bearer(w.outsider))
      .expect(404);
  });
});

describe('final grades (FR-ACAD-006/007/009)', () => {
  it('runs draft → submit → return → submit → approve and posts academic records', async () => {
    const w = await world();
    await gradebookWith(w);
    const [r1, r2] = w.regs;
    const sheet = await request(app)
      .get(`${api}/course-sections/${w.section.id}/final-grades`)
      .set(bearer(w.teacher))
      .expect(200);
    expect(sheet.body.data).toMatchObject({ status: 'DRAFT', canEdit: true, canDecide: false });
    expect(sheet.body.data.students.map((s: { suggested: string }) => s.suggested).sort()).toEqual([
      'A',
      'F',
    ]);

    const save = (who: { accessToken: string }, grades: object[]) =>
      request(app)
        .put(`${api}/course-sections/${w.section.id}/final-grades`)
        .set(bearer(who))
        .send({ grades });
    await save(w.assistant, [{ registrationId: r1!.id, gradeLetter: 'A' }]).expect(403);
    await save(w.teacher, [{ registrationId: r1!.id, gradeLetter: 'Z' }]).expect(422);
    await save(w.teacher, [{ registrationId: r1!.id, gradeLetter: 'a' }]).expect(200);
    const submit = () =>
      request(app)
        .post(`${api}/course-sections/${w.section.id}/final-grades/submit`)
        .set(bearer(w.teacher));
    expect((await submit().expect(422)).body.message).toMatch(/1 student/);
    await save(w.teacher, [{ registrationId: r2!.id, gradeLetter: 'C' }]).expect(200);
    await submit().expect(200);
    await save(w.teacher, [{ registrationId: r2!.id, gradeLetter: 'F' }]).expect(422);

    const queue = await request(app)
      .get(`${api}/grade-submissions`)
      .set(bearer(w.deptAdmin))
      .expect(200);
    expect(queue.body.data.map((s: { sectionId: string }) => s.sectionId)).toEqual([w.section.id]);
    const other = await request(app)
      .get(`${api}/grade-submissions`)
      .set(bearer(w.otherAdmin))
      .expect(200);
    expect(other.body.data).toEqual([]);
    await request(app)
      .post(`${api}/course-sections/${w.section.id}/final-grades/approve`)
      .set(bearer(w.otherAdmin))
      .expect(404);

    await request(app)
      .post(`${api}/course-sections/${w.section.id}/final-grades/return`)
      .set(bearer(w.deptAdmin))
      .send({ reason: 'Second student should be F per the exam.' })
      .expect(200);
    await save(w.teacher, [{ registrationId: r2!.id, gradeLetter: 'F' }]).expect(200);
    await submit().expect(200);
    const posted = await request(app)
      .post(`${api}/course-sections/${w.section.id}/final-grades/approve`)
      .set(bearer(w.deptAdmin))
      .expect(200);
    expect(posted.body.data).toMatchObject({ posted: 2, sheet: { status: 'POSTED' } });

    const records = await prisma.academicRecord.findMany({
      where: { registrationId: { in: [r1!.id, r2!.id] } },
      orderBy: { gradeLetter: 'asc' },
    });
    expect(
      records.map((r) => [
        r.gradeLetter,
        r.creditsEarned.toNumber(),
        r.passed,
        r.gradePoints?.toNumber(),
      ]),
    ).toEqual([
      ['A', 4, true, 10],
      ['F', 0, false, 0],
    ]);
    const section = await prisma.courseSection.findUniqueOrThrow({ where: { id: w.section.id } });
    expect(section.enrolledCount).toBe(0);
    expect(
      (await prisma.courseRegistration.findMany({ where: { sectionId: w.section.id } })).map(
        (r) => r.status,
      ),
    ).toEqual(['COMPLETED', 'COMPLETED']);
    const history = await request(app)
      .get(`${api}/students/me/history`)
      .set(bearer(w.s1))
      .expect(200);
    expect(history.body.data).toMatchObject({ cgpa: 10, creditsEarned: 4 });

    // Grade change: registrar only, with a reason; versions are kept.
    const failed = records.find((r) => r.gradeLetter === 'F')!;
    await request(app)
      .post(`${api}/academic-records/${failed.id}/grade-change`)
      .set(bearer(w.deptAdmin))
      .send({ gradeLetter: 'C', reason: 'Re-marked exam script after appeal.' })
      .expect(403);
    const changed = await request(app)
      .post(`${api}/academic-records/${failed.id}/grade-change`)
      .set(bearer(w.registrar))
      .send({ gradeLetter: 'C', reason: 'Re-marked exam script after appeal.' })
      .expect(200);
    expect(changed.body.data).toMatchObject({
      gradeLetter: 'C',
      version: 2,
      changes: [{ version: 2, from: 'F', to: 'C' }],
    });
    const after = await prisma.academicRecord.findUniqueOrThrow({ where: { id: failed.id } });
    expect([after.passed, after.creditsEarned.toNumber()]).toEqual([true, 4]);
    const own = await request(app)
      .get(`${api}/academic-records/${failed.id}/grade-history`)
      .set(bearer(w.s2))
      .expect(200);
    expect(own.body.data.canChange).toBe(false);
    await request(app)
      .get(`${api}/academic-records/${failed.id}/grade-history`)
      .set(bearer(w.s1))
      .expect(404);

    const transcript = await request(app)
      .get(`${api}/students/me/transcript`)
      .set(bearer(w.s2))
      .expect(200);
    expect(transcript.body.data).toMatchObject({
      student: { studentNumber: w.students[1]!.student.studentNumber },
      cgpa: 6,
      sessions: [{ courses: [{ code: 'ACA101', grade: 'C', version: 2 }] }],
    });
  });
});

describe('GPA repeat policy and classroom availability (FR-ACAD-002/008)', () => {
  it('drops superseded attempts under LATEST and BEST', () => {
    const rows = [
      {
        id: 'first',
        courseId: 'c',
        creditsAttempted: 4,
        creditsEarned: 0,
        gradePoints: 0,
        countsInGpa: true,
        order: 1,
      },
      {
        id: 'second',
        courseId: 'c',
        creditsAttempted: 4,
        creditsEarned: 4,
        gradePoints: 8,
        countsInGpa: true,
        order: 2,
      },
      {
        id: 'third',
        courseId: 'c',
        creditsAttempted: 4,
        creditsEarned: 4,
        gradePoints: 6,
        countsInGpa: true,
        order: 3,
      },
      {
        id: 'other',
        courseId: 'd',
        creditsAttempted: 3,
        creditsEarned: 3,
        gradePoints: 9,
        countsInGpa: true,
        order: 1,
      },
    ];
    expect([...supersededAttempts(rows, 'ALL')]).toEqual([]);
    expect([...supersededAttempts(rows, 'LATEST')].sort()).toEqual(['first', 'second']);
    expect([...supersededAttempts(rows, 'BEST')].sort()).toEqual(['first', 'third']);
  });

  it('lists booked meetings per classroom', async () => {
    const w = await world();
    const res = await request(app)
      .get(`${api}/classrooms/availability?sessionId=${w.session.id}`)
      .set(bearer(w.s1))
      .expect(200);
    const room = res.body.data.find((c: { id: string }) => c.id === w.room.id);
    expect(room.busy).toEqual([
      expect.objectContaining({
        dayOfWeek: 1,
        startMinute: 600,
        endMinute: 690,
        label: 'ACA101 A',
      }),
    ]);
    expect(room.utilization).toBeCloseTo(2.1, 1);
  });
});
