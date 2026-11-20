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
import { csvCell } from './teaching/teaching.service.js';

const app = createApp();
const api = '/api/v1';

beforeEach(resetState);
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
});

/** One department, a program, an active session, a teacher with a section of two students, and a colleague. */
async function classroom() {
  const school = await createSchool();
  const dept = await createDepartment(school.id);
  const program = await createProgram(dept.id);
  const session = await createSession();
  const course = await createCourse(dept.id, { credits: 4 });
  const teacher = await createFacultyRecord(dept.id);
  const colleague = await createFacultyRecord(dept.id);
  const section = await createSection(course.id, session.id, {
    status: 'PUBLISHED',
    instructorId: teacher.member.id,
    meetings: [{ dayOfWeek: 1, startMinute: 540, endMinute: 600 }],
  });
  const students = await Promise.all([
    createStudentRecord(program.id),
    createStudentRecord(program.id),
  ]);
  await prisma.user.update({
    where: { id: students[1].user.id },
    data: { firstName: '=HYPERLINK("http://evil")' },
  });
  for (const s of students)
    await prisma.courseRegistration.create({
      data: {
        studentId: s.student.id,
        sectionId: section.id,
        courseId: course.id,
        sessionId: session.id,
        status: 'REGISTERED',
        credits: 4,
        registeredAt: new Date(),
      },
    });
  await prisma.courseSection.update({ where: { id: section.id }, data: { enrolledCount: 2 } });
  return {
    dept,
    program,
    session,
    course,
    section,
    students,
    teacher: { ...teacher, auth: await login(app, teacher.user.email) },
    colleague: { ...colleague, auth: await login(app, colleague.user.email) },
  };
}

describe('teaching assignments and dashboard', () => {
  it('lists the faculty member’s sections and summarises the session', async () => {
    const c = await classroom();
    const upcoming = await createSession({ status: 'PLANNED' });
    await createSection(c.course.id, upcoming.id, {
      status: 'PUBLISHED',
      instructorId: c.teacher.member.id,
    });

    const current = await request(app)
      .get(`${api}/faculty/me/sections?scope=current`)
      .set(bearer(c.teacher.auth))
      .expect(200);
    expect(current.body.data).toHaveLength(1);
    expect(current.body.data[0]).toMatchObject({
      id: c.section.id,
      myRole: 'PRIMARY',
      enrolledCount: 2,
    });
    expect(
      (
        await request(app)
          .get(`${api}/faculty/me/sections?scope=upcoming`)
          .set(bearer(c.teacher.auth))
          .expect(200)
      ).body.data,
    ).toHaveLength(1);

    const dash = await request(app)
      .get(`${api}/faculty/me/dashboard`)
      .set(bearer(c.teacher.auth))
      .expect(200);
    expect(dash.body.data).toMatchObject({
      totalStudents: 2,
      upcomingSections: 1,
      load: { credits: 4 },
    });

    const student = await login(app, c.students[0].user.email);
    await request(app).get(`${api}/faculty/me/dashboard`).set(bearer(student)).expect(403);
  });
});

describe('roster', () => {
  it('is visible to the section’s instructors and scoped administrators only (FR-FACULTY-005)', async () => {
    const c = await classroom();
    const roster = await request(app)
      .get(`${api}/course-sections/${c.section.id}/roster`)
      .set(bearer(c.teacher.auth))
      .expect(200);
    expect(roster.body.data).toHaveLength(2);
    expect(roster.body.data[0].student).toHaveProperty('studentNumber');
    const search = await request(app)
      .get(`${api}/course-sections/${c.section.id}/roster?q=${c.students[0].student.studentNumber}`)
      .set(bearer(c.teacher.auth))
      .expect(200);
    expect(search.body.data).toHaveLength(1);

    // A colleague who does not teach the section cannot see that it exists.
    await request(app)
      .get(`${api}/course-sections/${c.section.id}/roster`)
      .set(bearer(c.colleague.auth))
      .expect(404);
    const deptAdmin = await createUser();
    await grantScoped(deptAdmin.id, 'DEPARTMENT_ADMIN', {
      scopeType: 'DEPARTMENT',
      scopeId: c.dept.id,
    });
    await request(app)
      .get(`${api}/course-sections/${c.section.id}/roster`)
      .set(bearer(await login(app, deptAdmin.email)))
      .expect(200);
    await request(app)
      .get(`${api}/course-sections/${c.section.id}/roster`)
      .set(bearer(await login(app, c.students[0].user.email)))
      .expect(403);
  });

  it('exports CSV with formulas neutralised and audits the export', async () => {
    const c = await classroom();
    const res = await request(app)
      .get(`${api}/course-sections/${c.section.id}/roster/export`)
      .set(bearer(c.teacher.auth))
      .expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=".*-roster\.csv"/);
    // The name cell starts with a formula: it must be prefixed with a quote and stay quoted.
    expect(res.text).toContain(`,"'=HYPERLINK(""http://evil"") `);
    expect(res.text).not.toMatch(/,"=HYPERLINK/);
    expect(await prisma.auditLog.count({ where: { action: 'roster.exported' } })).toBe(1);
    expect(csvCell('=1+2')).toBe(`"'=1+2"`);
    expect(csvCell('-5')).toBe(`"'-5"`);
    expect(csvCell('O"Brien')).toBe(`"O""Brien"`);
  });

  it('shows instructors an academic profile without contact details (FR-FACULTY-006)', async () => {
    const c = await classroom();
    const s = c.students[0].student;
    const res = await request(app)
      .get(`${api}/course-sections/${c.section.id}/students/${s.id}`)
      .set(bearer(c.teacher.auth))
      .expect(200);
    expect(res.body.data).toMatchObject({
      studentNumber: s.studentNumber,
      registration: { status: 'REGISTERED' },
    });
    expect(res.body.data).not.toHaveProperty('contact');
    expect(res.body.data).not.toHaveProperty('phone');
    const outsider = await createStudentRecord(c.program.id);
    await request(app)
      .get(`${api}/course-sections/${c.section.id}/students/${outsider.student.id}`)
      .set(bearer(c.teacher.auth))
      .expect(404);
  });
});

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

describe('materials', () => {
  async function uploadPdf(auth: { accessToken: string }) {
    const intent = await request(app)
      .post(`${api}/files/upload-intents`)
      .set(bearer(auth))
      .send({
        context: 'MATERIAL',
        fileName: 'week1.pdf',
        mimeType: 'application/pdf',
        sizeBytes: PDF.length,
      })
      .expect(201);
    await request(app)
      .put(new URL(intent.body.data.upload.url).pathname)
      .set('Content-Type', 'application/pdf')
      .send(PDF)
      .expect(204);
    await request(app)
      .post(`${api}/files/${intent.body.data.fileId}/complete`)
      .set(bearer(auth))
      .expect(200);
    return intent.body.data.fileId as string;
  }

  it('publishes files and links to registered students only (FR-FACULTY-007, FR-FILE-003)', async () => {
    const c = await classroom();
    const student = await login(app, c.students[0].user.email);
    // Students cannot upload course materials.
    await request(app)
      .post(`${api}/files/upload-intents`)
      .set(bearer(student))
      .send({ context: 'MATERIAL', fileName: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 10 })
      .expect(403);

    const fileId = await uploadPdf(c.teacher.auth);
    const file = await request(app)
      .post(`${api}/course-sections/${c.section.id}/materials`)
      .set(bearer(c.teacher.auth))
      .send({ title: 'Week 1 slides', folder: 'Week 1', kind: 'FILE', fileId })
      .expect(201);
    expect(file.body.data).toMatchObject({
      published: false,
      file: { name: 'week1.pdf', mimeType: 'application/pdf' },
    });
    await request(app)
      .post(`${api}/course-sections/${c.section.id}/materials`)
      .set(bearer(c.teacher.auth))
      .send({
        title: 'Reading list',
        kind: 'LINK',
        url: 'https://library.example.edu/list',
        publish: true,
      })
      .expect(201);

    const before = await request(app)
      .get(`${api}/course-sections/${c.section.id}/materials`)
      .set(bearer(student))
      .expect(200);
    expect(before.body.data.items.map((m: { title: string }) => m.title)).toEqual(['Reading list']);
    await request(app)
      .get(`${api}/materials/${file.body.data.id}/download`)
      .set(bearer(student))
      .expect(404);

    await request(app)
      .patch(`${api}/materials/${file.body.data.id}`)
      .set(bearer(c.teacher.auth))
      .send({ published: true })
      .expect(200);
    const link = await request(app)
      .get(`${api}/materials/${file.body.data.id}/download`)
      .set(bearer(student))
      .expect(200);
    const download = await request(app)
      .get(new URL(link.body.data.url).pathname + new URL(link.body.data.url).search)
      .expect(200);
    expect(
      Buffer.from(download.body as Buffer)
        .subarray(0, 8)
        .toString(),
    ).toBe('%PDF-1.4');

    // Someone outside the section cannot see or download anything.
    const outsider = await login(app, (await createStudentRecord(c.program.id)).user.email);
    await request(app)
      .get(`${api}/course-sections/${c.section.id}/materials`)
      .set(bearer(outsider))
      .expect(404);
    await request(app)
      .get(`${api}/materials/${file.body.data.id}/download`)
      .set(bearer(outsider))
      .expect(404);
    // Nor can a colleague edit it.
    await request(app)
      .patch(`${api}/materials/${file.body.data.id}`)
      .set(bearer(c.colleague.auth))
      .send({ published: false })
      .expect(404);

    await request(app)
      .delete(`${api}/materials/${file.body.data.id}`)
      .set(bearer(c.teacher.auth))
      .expect(200);
    expect((await prisma.storedFile.findUniqueOrThrow({ where: { id: fileId } })).status).toBe(
      'REJECTED',
    );
  });
});

describe('announcements', () => {
  it('publishes to the sections a faculty member teaches and notifies the class (FR-FACULTY-008/011)', async () => {
    const c = await classroom();
    const other = await createSection(c.course.id, c.session.id, {
      sectionCode: 'B',
      status: 'PUBLISHED',
      instructorId: c.colleague.member.id,
    });
    const body = {
      title: 'Quiz on Friday',
      body: 'Chapters 1–3, closed book.',
      priority: 'IMPORTANT',
      sectionIds: [c.section.id],
    };

    await request(app)
      .post(`${api}/announcements`)
      .set(bearer(c.teacher.auth))
      .send({ ...body, sectionIds: [c.section.id, other.id] })
      .expect(404);
    const res = await request(app)
      .post(`${api}/announcements`)
      .set(bearer(c.teacher.auth))
      .send(body)
      .expect(201);
    expect(res.body.data).toMatchObject({
      title: 'Quiz on Friday',
      mine: true,
      sections: [{ id: c.section.id }],
    });
    expect(
      await prisma.notification.count({
        where: { category: 'ANNOUNCEMENT', title: 'Quiz on Friday' },
      }),
    ).toBe(2);

    const student = await login(app, c.students[0].user.email);
    const list = await request(app)
      .get(`${api}/course-sections/${c.section.id}/announcements`)
      .set(bearer(student))
      .expect(200);
    expect(list.body.data).toMatchObject({
      canPublish: false,
      items: [{ title: 'Quiz on Friday', mine: false }],
    });
    await request(app).post(`${api}/announcements`).set(bearer(student)).send(body).expect(403);

    await request(app)
      .patch(`${api}/announcements/${res.body.data.id}`)
      .set(bearer(c.colleague.auth))
      .send({ pinned: true })
      .expect(404);
    await request(app)
      .patch(`${api}/announcements/${res.body.data.id}`)
      .set(bearer(c.teacher.auth))
      .send({ pinned: true })
      .expect(200);
    await request(app)
      .delete(`${api}/announcements/${res.body.data.id}`)
      .set(bearer(c.teacher.auth))
      .expect(200);
  });
});
