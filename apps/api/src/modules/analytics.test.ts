import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { prisma } from '../infrastructure/database/prisma.js';
import { closeQueues } from '../infrastructure/queues/queues.js';
import { storage } from '../infrastructure/storage/index.js';
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
import { invalidateDashboards } from './analytics/dashboard.service.js';
import { processExport } from './reports/exports.service.js';

const app = createApp();
const api = '/api/v1';

beforeEach(resetState);
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
});

async function world() {
  const school = await createSchool();
  const [cs, me] = await Promise.all([createDepartment(school.id), createDepartment(school.id)]);
  const [csProgram, meProgram] = await Promise.all([createProgram(cs.id), createProgram(me.id)]);
  const session = await createSession({ status: 'ACTIVE' });
  const csCourse = await createCourse(cs.id, { code: 'ANA101' });
  const meCourse = await createCourse(me.id, { code: 'MEC101' });
  await prisma.course.update({ where: { id: csCourse.id }, data: { minEnrollment: 5 } });
  const teacher = await createFacultyRecord(cs.id);
  const csSection = await createSection(csCourse.id, session.id, {
    status: 'PUBLISHED',
    capacity: 10,
    instructorId: teacher.member.id,
  });
  const meSection = await createSection(meCourse.id, session.id, {
    status: 'PUBLISHED',
    capacity: 20,
  });
  const students = [
    ...(await Promise.all([1, 2, 3].map(() => createStudentRecord(csProgram.id)))),
    await createStudentRecord(meProgram.id),
  ];
  for (const [i, s] of students.entries()) {
    const section = i < 3 ? csSection : meSection;
    await prisma.courseRegistration.create({
      data: {
        studentId: s.student.id,
        sectionId: section.id,
        courseId: section.courseId,
        sessionId: session.id,
        status: i === 2 ? 'PENDING' : 'REGISTERED',
        credits: 3,
      },
    });
  }
  await prisma.courseSection.update({ where: { id: csSection.id }, data: { enrolledCount: 3 } });
  await prisma.courseSection.update({ where: { id: meSection.id }, data: { enrolledCount: 1 } });
  const global = await createUser({ roles: ['UNIVERSITY_ADMIN'] });
  const scoped = await createUser();
  await grantScoped(scoped.id, 'DEPARTMENT_ADMIN', { scopeType: 'DEPARTMENT', scopeId: cs.id });
  return {
    cs,
    me,
    session,
    csSection,
    meSection,
    students,
    global: await login(app, global.email),
    scoped: await login(app, scoped.email),
    student: await login(app, students[0]!.user.email),
  };
}

describe('administrator dashboard (FR-ADMIN-001..006)', () => {
  it('AC-ADMIN-001: totals equal database counts, and scoped admins see only their scope', async () => {
    const w = await world();
    const res = await request(app).get(`${api}/dashboards/admin`).set(bearer(w.global)).expect(200);
    const c = res.body.data.counts;
    expect(c).toMatchObject({
      studentsTotal: await prisma.student.count(),
      studentsActive: await prisma.student.count({ where: { status: 'ACTIVE' } }),
      faculty: await prisma.facultyMember.count({ where: { employmentStatus: 'ACTIVE' } }),
      departments: await prisma.department.count(),
      programs: await prisma.program.count(),
      courses: await prisma.course.count({ where: { status: 'ACTIVE' } }),
      sections: 2,
      registrations: 4,
      pendingRegistrations: 1,
      availableSeats: 26,
      capacityUtilization: 13.3,
    });
    expect(res.body.data.charts.topCourses[0]).toMatchObject({ label: 'ANA101', value: 3 });
    expect(res.body.data.alerts).toMatchObject({
      belowMinimumCount: 1,
      belowMinimum: [{ label: 'ANA101 A', enrolled: 3, minimum: 5 }],
      withoutInstructorCount: 1,
    });

    const scoped = await request(app)
      .get(`${api}/dashboards/admin`)
      .set(bearer(w.scoped))
      .expect(200);
    expect(scoped.body.data).toMatchObject({
      scope: 'SCOPED',
      counts: { studentsTotal: 3, sections: 1, registrations: 3, departments: 1 },
    });
    // A filter outside the scope cannot widen it.
    const outside = await request(app)
      .get(`${api}/dashboards/admin?departmentId=${w.me.id}`)
      .set(bearer(w.scoped))
      .expect(200);
    expect(outside.body.data.counts).toMatchObject({ studentsTotal: 0, sections: 0 });
    await request(app).get(`${api}/dashboards/admin`).set(bearer(w.student)).expect(403);
  });

  it('caches for 60 seconds and recomputes after registration changes (FR-ADMIN-005)', async () => {
    const w = await world();
    const first = await request(app)
      .get(`${api}/dashboards/admin`)
      .set(bearer(w.global))
      .expect(200);
    const again = await request(app)
      .get(`${api}/dashboards/admin`)
      .set(bearer(w.global))
      .expect(200);
    expect([first.body.data.cached, again.body.data.cached]).toEqual([false, true]);
    invalidateDashboards();
    await new Promise((r) => setTimeout(r, 20));
    const fresh = await request(app)
      .get(`${api}/dashboards/admin`)
      .set(bearer(w.global))
      .expect(200);
    expect(fresh.body.data.cached).toBe(false);
  });
});

describe('report center (FR-RPT-001..004)', () => {
  it('lists the catalogue and runs scoped, sorted, paginated reports', async () => {
    const w = await world();
    const catalogue = await request(app).get(`${api}/reports`).set(bearer(w.global)).expect(200);
    expect(catalogue.body.data).toHaveLength(15);

    const students = await request(app)
      .get(`${api}/reports/students?sort=studentNumber:desc&limit=2`)
      .set(bearer(w.global))
      .expect(200);
    expect(students.body.data).toMatchObject({ total: 4, page: 1, sort: 'studentNumber:desc' });
    expect(students.body.data.rows).toHaveLength(2);
    const numbers = w.students
      .map((s) => s.student.studentNumber)
      .sort()
      .reverse();
    expect(students.body.data.rows.map((r: { studentNumber: string }) => r.studentNumber)).toEqual(
      numbers.slice(0, 2),
    );
    const scoped = await request(app)
      .get(`${api}/reports/students`)
      .set(bearer(w.scoped))
      .expect(200);
    expect(scoped.body.data.total).toBe(3);

    const enrollment = await request(app)
      .get(`${api}/reports/section-enrollment`)
      .set(bearer(w.global))
      .expect(200);
    expect(enrollment.body.data.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ section: 'ANA101 A', enrolled: 3, fill: 30 }),
      ]),
    );
    const incomplete = await request(app)
      .get(`${api}/reports/incomplete-registrations`)
      .set(bearer(w.global))
      .expect(200);
    expect(
      incomplete.body.data.rows.some((r: { reason: string }) => /Awaiting approval/.test(r.reason)),
    ).toBe(true);
    await request(app).get(`${api}/reports/nope`).set(bearer(w.global)).expect(404);
    await request(app).get(`${api}/reports/students`).set(bearer(w.student)).expect(403);
  });

  it('exports to XLSX and CSV, audits it, and runs large exports in the background', async () => {
    const w = await world();
    const xlsx = await request(app)
      .post(`${api}/reports/students/export`)
      .set(bearer(w.global))
      .send({ format: 'XLSX', filters: { departmentId: w.cs.id } })
      .expect(200);
    expect(xlsx.body.data).toMatchObject({ status: 'COMPLETED', rowCount: 3, format: 'XLSX' });
    const job = await prisma.exportJob.findUniqueOrThrow({
      where: { id: xlsx.body.data.id },
      include: { file: true },
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await storage.getObject(job.file!.storageKey)) as never);
    const sheet = book.worksheets[0]!;
    expect(sheet.getRow(1).getCell(1).value).toBe('Student number');
    expect(sheet.rowCount).toBe(4);
    expect(
      await prisma.auditLog.count({ where: { action: 'report.exported', entityId: job.id } }),
    ).toBe(1);
    const link = await request(app)
      .get(`${api}/reports/exports/${job.id}/download`)
      .set(bearer(w.global))
      .expect(200);
    expect(link.body.data.url).toMatch(/^http/);
    await request(app)
      .get(`${api}/reports/exports/${job.id}/download`)
      .set(bearer(w.scoped))
      .expect(404);

    const csv = await request(app)
      .post(`${api}/reports/capacity/export`)
      .set(bearer(w.global))
      .send({ format: 'CSV' })
      .expect(200);
    const csvJob = await prisma.exportJob.findUniqueOrThrow({
      where: { id: csv.body.data.id },
      include: { file: true },
    });
    const text = (await storage.getObject(csvJob.file!.storageKey)).toString('utf8');
    expect(text.startsWith('﻿"Department"')).toBe(true);

    // The worker path (used above 5,000 rows) re-runs the report with the requester's grants.
    const requester = await prisma.user.findFirstOrThrow({ where: { exportJobs: { some: {} } } });
    const queued = await prisma.exportJob.create({
      data: {
        requestedById: requester.id,
        reportKey: 'registrations',
        format: 'CSV',
        params: { filters: {} },
      },
    });
    expect(await processExport(queued.id)).toEqual({ rows: 4 });
    expect(await prisma.exportJob.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({
      status: 'COMPLETED',
      rowCount: 4,
    });
    expect(
      await prisma.notification.count({
        where: { userId: requester.id, title: 'Export ready: Registrations' },
      }),
    ).toBe(1);
  });
});
