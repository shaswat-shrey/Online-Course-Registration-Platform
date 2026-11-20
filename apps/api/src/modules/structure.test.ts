import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { RoleKey } from '@ucrams/shared';
import { createApp } from '../app.js';
import { prisma } from '../infrastructure/database/prisma.js';
import { closeQueues } from '../infrastructure/queues/queues.js';
import { resetState } from '../tests/db.js';
import {
  bearer,
  createDegree,
  createDepartment,
  createProgram,
  createSchool,
  createUser,
  grantScoped,
  login,
  type TestSession,
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

/** A department admin scoped to one department. */
async function deptAdmin(departmentId: string): Promise<TestSession> {
  const user = await createUser();
  await grantScoped(user.id, 'DEPARTMENT_ADMIN', {
    scopeType: 'DEPARTMENT',
    scopeId: departmentId,
  });
  return login(app, user.email);
}

describe('read access', () => {
  it('lets any signed-in user read structure, but not write it', async () => {
    const student = await as('STUDENT');
    const dept = await createDepartment();
    await request(app).get(`${api}/schools`).set(bearer(student)).expect(200);
    await request(app).get(`${api}/departments/${dept.id}`).set(bearer(student)).expect(200);
    await request(app).get(`${api}/programs`).set(bearer(student)).expect(200);
    await request(app).get(`${api}/academic-sessions`).set(bearer(student)).expect(200);
    await request(app)
      .post(`${api}/schools`)
      .set(bearer(student))
      .send({ code: 'X1', name: 'Nope' })
      .expect(403);
    await request(app)
      .patch(`${api}/departments/${dept.id}`)
      .set(bearer(student))
      .send({ name: 'Nope' })
      .expect(403);
  });
});

describe('university profile and campuses', () => {
  it('university admins edit the profile; others cannot', async () => {
    await prisma.university.create({ data: { name: 'Test University', shortName: 'TU' } });
    const ua = await as('UNIVERSITY_ADMIN');
    const registrar = await as('ACADEMIC_ADMIN');
    const res = await request(app)
      .patch(`${api}/university`)
      .set(bearer(ua))
      .send({ timezone: 'Asia/Kolkata', contactEmail: '' })
      .expect(200);
    expect(res.body.data).toMatchObject({ timezone: 'Asia/Kolkata', contactEmail: null });
    await request(app)
      .patch(`${api}/university`)
      .set(bearer(ua))
      .send({ timezone: 'Nowhere/City' })
      .expect(400);
    await request(app)
      .patch(`${api}/university`)
      .set(bearer(registrar))
      .send({ name: 'Hijack' })
      .expect(403);
    expect(await prisma.auditLog.count({ where: { action: 'university.updated' } })).toBe(1);
  });

  it('campuses in use cannot be deleted', async () => {
    const ua = await as('UNIVERSITY_ADMIN');
    const campus = (
      await request(app)
        .post(`${api}/campuses`)
        .set(bearer(ua))
        .send({ code: 'main', name: 'Main Campus' })
        .expect(201)
    ).body.data;
    expect(campus.code).toBe('MAIN');
    await request(app)
      .post(`${api}/campuses`)
      .set(bearer(ua))
      .send({ code: 'MAIN', name: 'Duplicate' })
      .expect(409);
    await prisma.school.create({ data: { code: 'S1', name: 'School One', campusId: campus.id } });
    const res = await request(app)
      .delete(`${api}/campuses/${campus.id}`)
      .set(bearer(ua))
      .expect(422);
    expect(res.body.error.details).toEqual({ schools: 1, departments: 0 });
  });
});

describe('faculties/schools', () => {
  it('creates, rejects duplicate codes, and protects schools with departments', async () => {
    const ua = await as('UNIVERSITY_ADMIN');
    const created = await request(app)
      .post(`${api}/schools`)
      .set(bearer(ua))
      .send({ code: 'eng', name: 'Faculty of Engineering', website: 'https://eng.example.edu' })
      .expect(201);
    const id = created.body.data.id;
    const dup = await request(app)
      .post(`${api}/schools`)
      .set(bearer(ua))
      .send({ code: 'ENG', name: 'Again' })
      .expect(409);
    expect(dup.body.error.details.fields[0].path).toBe('body.code');

    await createDepartment(id);
    const deactivate = await request(app)
      .patch(`${api}/schools/${id}`)
      .set(bearer(ua))
      .send({ status: 'INACTIVE' })
      .expect(422);
    expect(deactivate.body.error.details).toEqual({ activeDepartments: 1 });
    await request(app).delete(`${api}/schools/${id}`).set(bearer(ua)).expect(422);

    const empty = await createSchool();
    await request(app).delete(`${api}/schools/${empty.id}`).set(bearer(ua)).expect(200);
  });

  it('lists with search, status filter and pagination', async () => {
    const student = await as('STUDENT');
    await prisma.school.createMany({
      data: [
        { code: 'ENG', name: 'Faculty of Engineering' },
        { code: 'SCI', name: 'Faculty of Science' },
        { code: 'LAW', name: 'Faculty of Law', status: 'INACTIVE' },
      ],
    });
    const res = await request(app)
      .get(`${api}/schools?q=faculty&status=ACTIVE&limit=1&sort=code:desc`)
      .set(bearer(student))
      .expect(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
    expect(res.body.data[0].code).toBe('SCI');
    await request(app).get(`${api}/schools?sort=password:asc`).set(bearer(student)).expect(400);
  });
});

describe('departments and department-scoped administration (AC-RBAC-001)', () => {
  it('a department admin edits only their own department and cannot create or move departments', async () => {
    const school = await createSchool();
    const own = await createDepartment(school.id);
    const other = await createDepartment(school.id);
    const otherSchool = await createSchool();
    const da = await deptAdmin(own.id);

    const list = await request(app)
      .get(`${api}/departments?schoolId=${school.id}`)
      .set(bearer(da))
      .expect(200);
    const flags = Object.fromEntries(
      list.body.data.map((d: { id: string; canManage: boolean }) => [d.id, d.canManage]),
    );
    expect(flags).toEqual({ [own.id]: true, [other.id]: false });

    await request(app)
      .patch(`${api}/departments/${own.id}`)
      .set(bearer(da))
      .send({ officeLocation: 'Block A, 101' })
      .expect(200);
    await request(app)
      .patch(`${api}/departments/${other.id}`)
      .set(bearer(da))
      .send({ name: 'Taken over' })
      .expect(403);
    await request(app)
      .post(`${api}/departments`)
      .set(bearer(da))
      .send({ code: 'NEW', name: 'New Department', schoolId: school.id })
      .expect(403);
    await request(app)
      .patch(`${api}/departments/${own.id}`)
      .set(bearer(da))
      .send({ schoolId: otherSchool.id })
      .expect(403);
  });

  it('a school-scoped academic admin creates departments only in their school', async () => {
    const mine = await createSchool();
    const theirs = await createSchool();
    const user = await createUser();
    await grantScoped(user.id, 'ACADEMIC_ADMIN', { scopeType: 'SCHOOL', scopeId: mine.id });
    const s = await login(app, user.email);
    await request(app)
      .post(`${api}/departments`)
      .set(bearer(s))
      .send({ code: 'D1', name: 'Dept One', schoolId: mine.id })
      .expect(201);
    await request(app)
      .post(`${api}/departments`)
      .set(bearer(s))
      .send({ code: 'D2', name: 'Dept Two', schoolId: theirs.id })
      .expect(403);
  });

  it('refuses inactive parents and protects departments with programs', async () => {
    const ua = await as('UNIVERSITY_ADMIN');
    const inactive = await createSchool({ status: 'INACTIVE' });
    const res = await request(app)
      .post(`${api}/departments`)
      .set(bearer(ua))
      .send({ code: 'GHOST', name: 'Ghost Dept', schoolId: inactive.id })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');

    const dept = await createDepartment();
    await createProgram(dept.id);
    await request(app)
      .patch(`${api}/departments/${dept.id}`)
      .set(bearer(ua))
      .send({ status: 'INACTIVE' })
      .expect(422);
    await request(app).delete(`${api}/departments/${dept.id}`).set(bearer(ua)).expect(422);
    const detail = await request(app)
      .get(`${api}/departments/${dept.id}`)
      .set(bearer(ua))
      .expect(200);
    expect(detail.body.data).toMatchObject({
      programCount: 1,
      specializationCount: 0,
      canManage: true,
    });
  });

  it('scoped role assignments now resolve real departments', async () => {
    const sa = await as('SUPER_ADMIN');
    const dept = await createDepartment();
    const target = await createUser();
    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'DEPARTMENT_ADMIN' } });
    await request(app)
      .post(`${api}/users/${target.id}/roles`)
      .set(bearer(sa))
      .send({ roleId: role.id, scopeType: 'DEPARTMENT', scopeId: dept.id })
      .expect(201);
    const s = await login(app, target.email);
    await request(app)
      .patch(`${api}/departments/${dept.id}`)
      .set(bearer(s))
      .send({ contactPhone: '+91 80 1234' })
      .expect(200);
    // Departments referenced by role assignments cannot be deleted.
    await request(app).delete(`${api}/departments/${dept.id}`).set(bearer(sa)).expect(422);
  });
});

describe('degrees', () => {
  it('manages degrees and blocks deactivating one that active programs award', async () => {
    const registrar = await as('ACADEMIC_ADMIN');
    const created = await request(app)
      .post(`${api}/degrees`)
      .set(bearer(registrar))
      .send({ code: 'BTECH', name: 'Bachelor of Technology', level: 'UNDERGRADUATE' })
      .expect(201);
    const dept = await createDepartment();
    await prisma.program.create({
      data: {
        code: 'P1',
        name: 'Prog',
        degreeId: created.body.data.id,
        departmentId: dept.id,
        durationYears: 4,
        sessionCount: 8,
        totalCredits: 160,
      },
    });
    await request(app)
      .patch(`${api}/degrees/${created.body.data.id}`)
      .set(bearer(registrar))
      .send({ status: 'INACTIVE' })
      .expect(422);
    const da = await deptAdmin(dept.id);
    await request(app)
      .post(`${api}/degrees`)
      .set(bearer(da))
      .send({ code: 'BX', name: 'Bachelor X', level: 'UNDERGRADUATE' })
      .expect(403);
  });
});

describe('programs, specializations and requirement groups', () => {
  it('department admins create programs in their department only', async () => {
    const own = await createDepartment();
    const other = await createDepartment();
    const degree = await createDegree();
    const da = await deptAdmin(own.id);
    const body = {
      code: 'btech-x',
      name: 'B.Tech X',
      degreeId: degree.id,
      durationYears: 4,
      sessionCount: 8,
      totalCredits: 160,
    };
    const created = await request(app)
      .post(`${api}/programs`)
      .set(bearer(da))
      .send({ ...body, departmentId: own.id })
      .expect(201);
    expect(created.body.data).toMatchObject({
      code: 'BTECH-X',
      totalCredits: 160,
      canManage: true,
    });
    await request(app)
      .post(`${api}/programs`)
      .set(bearer(da))
      .send({ ...body, code: 'YY', departmentId: other.id })
      .expect(403);
    // Moving it to a department they don't administer
    await request(app)
      .patch(`${api}/programs/${created.body.data.id}`)
      .set(bearer(da))
      .send({ departmentId: other.id })
      .expect(403);
  });

  it('validates credits and parents', async () => {
    const ua = await as('UNIVERSITY_ADMIN');
    const dept = await createDepartment();
    const inactiveDegree = await createDegree({ status: 'INACTIVE' });
    const degree = await createDegree();
    const base = {
      code: 'PP',
      name: 'Program P',
      departmentId: dept.id,
      durationYears: 4,
      sessionCount: 8,
      totalCredits: 100,
    };
    await request(app)
      .post(`${api}/programs`)
      .set(bearer(ua))
      .send({ ...base, degreeId: inactiveDegree.id })
      .expect(422);
    await request(app)
      .post(`${api}/programs`)
      .set(bearer(ua))
      .send({ ...base, degreeId: degree.id, minCoreCredits: 80, minElectiveCredits: 30 })
      .expect(400);
    const p = (
      await request(app)
        .post(`${api}/programs`)
        .set(bearer(ua))
        .send({ ...base, degreeId: degree.id, minCoreCredits: 60 })
        .expect(201)
    ).body.data;
    // Lowering total below core minimum is rejected server-side even in a partial update.
    await request(app)
      .patch(`${api}/programs/${p.id}`)
      .set(bearer(ua))
      .send({ totalCredits: 50 })
      .expect(422);
  });

  it('keeps requirement groups within the program credit budget and validates kinds', async () => {
    const ua = await as('UNIVERSITY_ADMIN');
    const program = await createProgram((await createDepartment()).id, { totalCredits: 40 });
    const url = `${api}/programs/${program.id}/requirement-groups`;
    await request(app).post(url).set(bearer(ua)).send({ name: 'Core', kind: 'ALL_OF' }).expect(201);
    await request(app)
      .post(url)
      .set(bearer(ua))
      .send({ name: 'Electives', kind: 'CREDITS_ANY', minCredits: 30 })
      .expect(201);
    const over = await request(app)
      .post(url)
      .set(bearer(ua))
      .send({ name: 'Labs', kind: 'CREDITS_FROM_CATEGORY', minCredits: 12, category: 'LABORATORY' })
      .expect(422);
    expect(over.body.error.details.fields[0].message).toBe('At most 10 credits remain');
    await request(app)
      .post(url)
      .set(bearer(ua))
      .send({ name: 'Labs', kind: 'CREDITS_FROM_CATEGORY', minCredits: 6 })
      .expect(400);
    await request(app)
      .patch(`${api}/programs/${program.id}`)
      .set(bearer(ua))
      .send({ totalCredits: 20 })
      .expect(422);

    const detail = await request(app)
      .get(`${api}/programs/${program.id}`)
      .set(bearer(ua))
      .expect(200);
    expect(
      detail.body.data.requirementGroups.map((g: { name: string; position: number }) => [
        g.name,
        g.position,
      ]),
    ).toEqual([
      ['Core', 0],
      ['Electives', 1],
    ]);
    const groupId = detail.body.data.requirementGroups[1].id;
    await request(app)
      .put(`${api}/requirement-groups/${groupId}`)
      .set(bearer(ua))
      .send({ name: 'Open electives', kind: 'CREDITS_ANY', minCredits: 40 })
      .expect(200);
    await request(app).delete(`${api}/requirement-groups/${groupId}`).set(bearer(ua)).expect(200);
  });

  it('manages specializations with per-program codes and scope', async () => {
    const dept = await createDepartment();
    const program = await createProgram(dept.id);
    const otherProgram = await createProgram((await createDepartment()).id);
    const da = await deptAdmin(dept.id);
    const spec = (
      await request(app)
        .post(`${api}/specializations`)
        .set(bearer(da))
        .send({
          programId: program.id,
          code: 'aiml',
          name: 'AI and Machine Learning',
          additionalCredits: 18,
        })
        .expect(201)
    ).body.data;
    await request(app)
      .post(`${api}/specializations`)
      .set(bearer(da))
      .send({ programId: program.id, code: 'AIML', name: 'Duplicate' })
      .expect(409);
    await request(app)
      .post(`${api}/specializations`)
      .set(bearer(da))
      .send({ programId: otherProgram.id, code: 'XX', name: 'Not mine' })
      .expect(403);
    await request(app)
      .post(`${api}/specializations/${spec.id}/requirement-groups`)
      .set(bearer(da))
      .send({ name: 'Spec core', kind: 'ALL_OF' })
      .expect(201);
    const list = await request(app)
      .get(`${api}/programs/${program.id}/specializations`)
      .set(bearer(da))
      .expect(200);
    expect(list.body.data[0]).toMatchObject({
      code: 'AIML',
      additionalCredits: 18,
      requirementGroups: [{ name: 'Spec core' }],
    });

    // Program with specializations: cannot delete or deactivate while they are active.
    const ua = await as('UNIVERSITY_ADMIN');
    await request(app).delete(`${api}/programs/${program.id}`).set(bearer(ua)).expect(422);
    await request(app)
      .patch(`${api}/programs/${program.id}`)
      .set(bearer(ua))
      .send({ status: 'INACTIVE' })
      .expect(422);
    await request(app)
      .patch(`${api}/specializations/${spec.id}`)
      .set(bearer(ua))
      .send({ status: 'INACTIVE' })
      .expect(200);
    await request(app)
      .patch(`${api}/programs/${program.id}`)
      .set(bearer(ua))
      .send({ status: 'INACTIVE' })
      .expect(200);
  });

  it('filters programs by school, degree level and search', async () => {
    const student = await as('STUDENT');
    const school = await createSchool();
    const dept = await createDepartment(school.id);
    await createProgram(dept.id);
    await createProgram((await createDepartment()).id);
    const res = await request(app)
      .get(`${api}/programs?schoolId=${school.id}&level=UNDERGRADUATE`)
      .set(bearer(student))
      .expect(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({
      canManage: false,
      department: { id: dept.id, schoolId: school.id },
    });
  });
});

describe('academic calendar', () => {
  async function yearAndSession(registrar: TestSession) {
    const year = (
      await request(app)
        .post(`${api}/academic-years`)
        .set(bearer(registrar))
        .send({ label: '2026-2027', startDate: '2026-07-01', endDate: '2027-06-30' })
        .expect(201)
    ).body.data;
    const session = (
      await request(app)
        .post(`${api}/academic-sessions`)
        .set(bearer(registrar))
        .send({
          academicYearId: year.id,
          code: 'spring-2027',
          name: 'Spring 2027',
          type: 'SPRING',
          startDate: '2027-01-11',
          endDate: '2027-05-21',
        })
        .expect(201)
    ).body.data;
    return { year, session };
  }

  it('creates years and sessions within their year', async () => {
    const registrar = await as('ACADEMIC_ADMIN');
    const { year, session } = await yearAndSession(registrar);
    expect(session).toMatchObject({
      code: 'SPRING-2027',
      status: 'PLANNED',
      isCurrent: false,
      registrationState: 'NOT_CONFIGURED',
    });
    await request(app)
      .post(`${api}/academic-years`)
      .set(bearer(registrar))
      .send({ label: '2026-2027', startDate: '2026-07-01', endDate: '2027-06-30' })
      .expect(409);
    const outside = await request(app)
      .post(`${api}/academic-sessions`)
      .set(bearer(registrar))
      .send({
        academicYearId: year.id,
        code: 'OUTSIDE',
        name: 'Outside',
        type: 'SUMMER',
        startDate: '2027-06-01',
        endDate: '2027-07-31',
      })
      .expect(422);
    expect(outside.body.message).toMatch(/within 2026-2027/);
    await request(app)
      .delete(`${api}/academic-years/${year.id}`)
      .set(bearer(registrar))
      .expect(422);
  });

  it('enforces the session lifecycle and a single current session per type', async () => {
    const registrar = await as('ACADEMIC_ADMIN');
    const { year, session } = await yearAndSession(registrar);
    const other = (
      await request(app)
        .post(`${api}/academic-sessions`)
        .set(bearer(registrar))
        .send({
          academicYearId: year.id,
          code: 'SPRING-B',
          name: 'Spring B',
          type: 'SPRING',
          startDate: '2027-02-01',
          endDate: '2027-05-01',
        })
        .expect(201)
    ).body.data;
    const t = (id: string, action: string) =>
      request(app)
        .post(`${api}/academic-sessions/${id}/transition`)
        .set(bearer(registrar))
        .send({ action });

    await t(session.id, 'make-current').expect(200);
    await t(other.id, 'make-current').expect(200);
    const sessions = await request(app)
      .get(`${api}/academic-sessions?current=true`)
      .set(bearer(registrar))
      .expect(200);
    expect(sessions.body.data.map((s: { id: string }) => s.id)).toEqual([other.id]);

    await t(session.id, 'complete').expect(422);
    await t(session.id, 'activate').expect(200);
    await request(app)
      .delete(`${api}/academic-sessions/${session.id}`)
      .set(bearer(registrar))
      .expect(422);
    const completed = await t(session.id, 'complete').expect(200);
    expect(completed.body.data).toMatchObject({ status: 'COMPLETED', isCurrent: false });
    await t(session.id, 'archive').expect(200);
    await request(app)
      .patch(`${api}/academic-sessions/${session.id}`)
      .set(bearer(registrar))
      .send({ name: 'Edited' })
      .expect(422);
    expect(
      await prisma.auditLog.count({
        where: { entityId: session.id, action: { startsWith: 'session.' } },
      }),
    ).toBeGreaterThanOrEqual(5);
  });

  it('saves policy, registration period and priority windows with ordering rules', async () => {
    const registrar = await as('ACADEMIC_ADMIN');
    const { session } = await yearAndSession(registrar);
    const policy = {
      minCredits: 12,
      maxCredits: 24,
      maxCreditsWithOverride: 28,
      approvalMode: 'LATE_ONLY',
      waitlistEnabled: true,
      waitlistMaxPerSection: 10,
      promotionMode: 'AUTO_ENROLL',
      offerWindowHours: 24,
      countWaitlistInCredits: false,
      allowInProgressPrereqs: true,
      withdrawalRequiresApproval: false,
    };
    await request(app)
      .put(`${api}/academic-sessions/${session.id}/policy`)
      .set(bearer(registrar))
      .send({ ...policy, minCredits: 30 })
      .expect(400);
    await request(app)
      .put(`${api}/academic-sessions/${session.id}/policy`)
      .set(bearer(registrar))
      .send(policy)
      .expect(200);

    const period = {
      opensAt: '2026-12-01T03:30:00Z',
      closesAt: '2027-01-10T18:29:00Z',
      lateClosesAt: '2027-01-17T18:29:00Z',
      addDropDeadline: '2027-01-24T18:29:00Z',
      withdrawalDeadline: '2027-04-16T18:29:00Z',
    };
    const url = `${api}/academic-sessions/${session.id}`;
    await request(app)
      .put(`${url}/registration-period`)
      .set(bearer(registrar))
      .send({ ...period, closesAt: '2026-11-01T00:00:00Z' })
      .expect(400);
    await request(app)
      .put(`${url}/registration-period`)
      .set(bearer(registrar))
      .send({ ...period, withdrawalDeadline: '2027-06-30T00:00:00Z' })
      .expect(422);
    const saved = await request(app)
      .put(`${url}/registration-period`)
      .set(bearer(registrar))
      .send(period)
      .expect(200);
    expect(saved.body.data.policy).toMatchObject({ maxCredits: 24, approvalMode: 'LATE_ONLY' });

    await request(app)
      .post(`${url}/priority-windows`)
      .set(bearer(registrar))
      .send({ name: 'Seniors', opensAt: '2026-12-02T00:00:00Z', yearOfStudy: 4 })
      .expect(422);
    await request(app)
      .post(`${url}/priority-windows`)
      .set(bearer(registrar))
      .send({ name: 'Nobody', opensAt: '2026-11-27T00:00:00Z' })
      .expect(400);
    const withWindow = await request(app)
      .post(`${url}/priority-windows`)
      .set(bearer(registrar))
      .send({ name: 'Seniors', opensAt: '2026-11-27T03:30:00Z', yearOfStudy: 4 })
      .expect(201);
    const windowId = withWindow.body.data.registrationPeriod.priorityWindows[0].id;
    // General registration cannot move before an existing priority window.
    await request(app)
      .put(`${url}/registration-period`)
      .set(bearer(registrar))
      .send({ ...period, opensAt: '2026-11-20T00:00:00Z' })
      .expect(422);
    await request(app)
      .delete(`${url}/priority-windows/${windowId}`)
      .set(bearer(registrar))
      .expect(200);

    // University admins hold registration_period:manage; faculty do not.
    const faculty = await as('FACULTY');
    await request(app).put(`${url}/policy`).set(bearer(faculty)).send(policy).expect(403);
  });

  it('computes the registration state from the period', async () => {
    const { registrationState } = await import('./academic-sessions/calendar.service.js');
    const p = {
      opensAt: new Date('2026-12-01T00:00:00Z'),
      closesAt: new Date('2026-12-10T00:00:00Z'),
      lateClosesAt: new Date('2026-12-12T00:00:00Z'),
      addDropDeadline: new Date('2026-12-20T00:00:00Z'),
    } as never;
    expect(registrationState(null)).toBe('NOT_CONFIGURED');
    expect(registrationState(p, new Date('2026-11-30T00:00:00Z'))).toBe('UPCOMING');
    expect(registrationState(p, new Date('2026-12-05T00:00:00Z'))).toBe('OPEN');
    expect(registrationState(p, new Date('2026-12-11T00:00:00Z'))).toBe('LATE');
    expect(registrationState(p, new Date('2026-12-15T00:00:00Z'))).toBe('ADD_DROP');
    expect(registrationState(p, new Date('2026-12-21T00:00:00Z'))).toBe('CLOSED');
  });
});

describe('grading scales', () => {
  const entries = [
    { letter: 'a', minPercent: 80, gradePoints: 4, isPassing: true },
    { letter: 'F', minPercent: 0, gradePoints: 0, isPassing: false },
  ];

  it('creates sorted scales and locks bands once a completed session uses them', async () => {
    const registrar = await as('ACADEMIC_ADMIN');
    const scale = (
      await request(app)
        .post(`${api}/grading-scales`)
        .set(bearer(registrar))
        .send({ name: 'Simple', entries })
        .expect(201)
    ).body.data;
    expect(scale.entries.map((e: { letter: string }) => e.letter)).toEqual(['A', 'F']);
    expect(scale.hasGradePoints).toBe(true);
    await request(app)
      .post(`${api}/grading-scales`)
      .set(bearer(registrar))
      .send({ name: 'Bad', entries: [entries[0]] })
      .expect(400);

    const year = await prisma.academicYear.create({
      data: {
        label: '2025-2026',
        startDate: new Date('2025-07-01'),
        endDate: new Date('2026-06-30'),
      },
    });
    await prisma.academicSession.create({
      data: {
        academicYearId: year.id,
        code: 'FALL-2025',
        name: 'Fall 2025',
        type: 'FALL',
        startDate: new Date('2025-08-01'),
        endDate: new Date('2025-12-15'),
        status: 'COMPLETED',
        gradingScaleId: scale.id,
      },
    });
    const changed = [{ ...entries[0], minPercent: 85 }, entries[1]];
    const locked = await request(app)
      .put(`${api}/grading-scales/${scale.id}`)
      .set(bearer(registrar))
      .send({ name: 'Simple', entries: changed })
      .expect(422);
    expect(locked.body.error.details).toEqual({ completedSessions: 1 });
    // Renaming without changing bands is allowed.
    await request(app)
      .put(`${api}/grading-scales/${scale.id}`)
      .set(bearer(registrar))
      .send({ name: 'Simple (2025)', entries })
      .expect(200);
    await request(app)
      .delete(`${api}/grading-scales/${scale.id}`)
      .set(bearer(registrar))
      .expect(422);
  });
});
