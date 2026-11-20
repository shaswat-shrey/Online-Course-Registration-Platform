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
  login,
} from '../tests/factories.js';
import { fanOutAnnouncement } from './announcements/announcements.service.js';

const app = createApp();
const api = '/api/v1';

beforeEach(resetState);
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
});

/**
 * Write paths that must stay correct under parallel requests (NFR-CONC).
 * Registration races are covered by AC-REG-001 in registrations.test.ts.
 */
describe('concurrency', () => {
  it('gives parallel tickets distinct sequential numbers', async () => {
    const school = await createSchool();
    const program = await createProgram((await createDepartment(school.id)).id);
    const auth = await login(app, (await createStudentRecord(program.id)).user.email);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        request(app)
          .post(`${api}/tickets`)
          .set(bearer(auth))
          .send({
            category: 'OTHER',
            subject: `Parallel ${i}`,
            description: 'Concurrency check ticket.',
          }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(12).fill(201));
    const numbers = results.map((r) => r.body.data.ticketNumber as string);
    expect(new Set(numbers).size).toBe(12);
    const year = new Date().getUTCFullYear();
    expect(numbers.sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => `TCK-${year}-${String(i + 1).padStart(6, '0')}`),
    );
  });

  it('posts grades once when approval is clicked twice at the same time', async () => {
    const school = await createSchool();
    const dept = await createDepartment(school.id);
    const program = await createProgram(dept.id);
    const scale = await prisma.gradingScale.create({
      data: {
        name: 'Pass/fail race',
        entries: {
          create: [
            { letter: 'P', minPercent: 50, gradePoints: null, isPassing: true, position: 0 },
            { letter: 'F', minPercent: 0, gradePoints: null, isPassing: false, position: 1 },
          ],
        },
      },
    });
    const session = await createSession({ status: 'ACTIVE' });
    await prisma.academicSession.update({
      where: { id: session.id },
      data: { gradingScaleId: scale.id },
    });
    const course = await createCourse(dept.id, { code: 'RACE101' });
    const teacher = await createFacultyRecord(dept.id);
    const section = await createSection(course.id, session.id, {
      status: 'PUBLISHED',
      instructorId: teacher.member.id,
    });
    const regs = [];
    for (let i = 0; i < 5; i++) {
      const s = await createStudentRecord(program.id);
      regs.push(
        await prisma.courseRegistration.create({
          data: {
            studentId: s.student.id,
            sectionId: section.id,
            courseId: course.id,
            sessionId: session.id,
            status: 'REGISTERED',
            credits: 3,
          },
        }),
      );
    }
    await prisma.courseSection.update({ where: { id: section.id }, data: { enrolledCount: 5 } });
    const tAuth = await login(app, teacher.user.email);
    await request(app)
      .put(`${api}/course-sections/${section.id}/final-grades`)
      .set(bearer(tAuth))
      .send({ grades: regs.map((r) => ({ registrationId: r.id, gradeLetter: 'P' })) })
      .expect(200);
    await request(app)
      .post(`${api}/course-sections/${section.id}/final-grades/submit`)
      .set(bearer(tAuth))
      .expect(200);

    const registrar = await login(app, (await createUser({ roles: ['ACADEMIC_ADMIN'] })).email);
    const approve = () =>
      request(app)
        .post(`${api}/course-sections/${section.id}/final-grades/approve`)
        .set(bearer(registrar));
    const [a, b] = await Promise.all([approve(), approve()]);
    expect([a.status, b.status].sort()).toEqual([200, 422]);
    expect(await prisma.academicRecord.count({ where: { courseId: course.id } })).toBe(5);
    const s = await prisma.courseSection.findUniqueOrThrow({ where: { id: section.id } });
    expect(s.enrolledCount).toBe(0);
  });

  it('fans an announcement out once even when the job runs twice in parallel', async () => {
    const school = await createSchool();
    const program = await createProgram((await createDepartment(school.id)).id);
    await Promise.all([1, 2, 3].map(() => createStudentRecord(program.id)));
    const admin = await login(app, (await createUser({ roles: ['SUPER_ADMIN'] })).email);
    const a = await request(app)
      .post(`${api}/announcements`)
      .set(bearer(admin))
      .send({ title: 'Once only', body: 'x', audiences: [{ type: 'ALL_STUDENTS' }] })
      .expect(201);
    const runs = await Promise.all([
      fanOutAnnouncement(a.body.data.id),
      fanOutAnnouncement(a.body.data.id),
    ]);
    expect(runs.map((r) => r.notified).sort()).toEqual([0, 3]);
    expect(await prisma.notification.count({ where: { title: 'Once only' } })).toBe(3);
  });
});
