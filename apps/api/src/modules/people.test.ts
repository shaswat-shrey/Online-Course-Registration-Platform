import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { RoleKey } from '@ucrams/shared';
import { createApp } from '../app.js';
import { prisma } from '../infrastructure/database/prisma.js';
import { closeQueues, getQueue, QueueName } from '../infrastructure/queues/queues.js';
import { resetState } from '../tests/db.js';
import {
  bearer,
  createDepartment,
  createFacultyRecord,
  createProgram,
  createSchool,
  createStudentRecord,
  createUser,
  grantScoped,
  login,
  TEST_PASSWORD,
} from '../tests/factories.js';
import { processImportJob } from './imports/imports.service.js';

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
async function emailJobs(name: string) {
  const jobs = await getQueue(QueueName.EMAIL).getJobs([
    'waiting',
    'delayed',
    'completed',
    'failed',
  ]);
  return jobs.filter((j) => j.name === name);
}
/** Two departments in one school, each with a program. */
async function campusFixture() {
  const school = await createSchool();
  const cs = await prisma.department.create({
    data: { code: 'CS', name: 'Computer Science', schoolId: school.id },
  });
  const me = await createDepartment(school.id);
  const csProgram = await createProgram(cs.id);
  const meProgram = await createProgram(me.id);
  return { school, cs, me, csProgram, meProgram };
}

describe('students', () => {
  it('creates a student with a generated number and an invitation', async () => {
    const { csProgram } = await campusFixture();
    const registrar = await as('ACADEMIC_ADMIN');
    const res = await request(app)
      .post(`${api}/students`)
      .set(bearer(registrar))
      .send({
        email: 'New.Student@Test.edu',
        firstName: 'Asha',
        lastName: 'Rao',
        programId: csProgram.id,
        yearOfStudy: 1,
      })
      .expect(201);
    const yy = String(new Date().getUTCFullYear() % 100).padStart(2, '0');
    expect(res.body.data).toMatchObject({
      studentNumber: `${yy}CS0001`,
      email: 'new.student@test.edu',
      status: 'ACTIVE',
    });
    expect(res.body.data.account).toMatchObject({ status: 'INVITED', activated: false });
    expect((await emailJobs('invitation')).map((j) => j.data.to)).toEqual(['new.student@test.edu']);
    const second = await request(app)
      .post(`${api}/students`)
      .set(bearer(registrar))
      .send({
        email: 'second@test.edu',
        firstName: 'B',
        lastName: 'C',
        programId: csProgram.id,
        yearOfStudy: 1,
        sendInvite: false,
      })
      .expect(201);
    expect(second.body.data.studentNumber).toBe(`${yy}CS0002`);
    await request(app)
      .post(`${api}/students`)
      .set(bearer(registrar))
      .send({
        email: 'new.student@test.edu',
        firstName: 'Dup',
        lastName: 'Licate',
        programId: csProgram.id,
        yearOfStudy: 1,
      })
      .expect(409);
  });

  it('enforces department scope for creation and listing', async () => {
    const { cs, csProgram, meProgram } = await campusFixture();
    const da = await deptAdmin(cs.id);
    await request(app)
      .post(`${api}/students`)
      .set(bearer(da))
      .send({
        email: 'own@test.edu',
        firstName: 'O',
        lastName: 'Wn',
        programId: csProgram.id,
        yearOfStudy: 1,
      })
      .expect(201);
    await request(app)
      .post(`${api}/students`)
      .set(bearer(da))
      .send({
        email: 'other@test.edu',
        firstName: 'O',
        lastName: 'Ther',
        programId: meProgram.id,
        yearOfStudy: 1,
      })
      .expect(403);
    await createStudentRecord(meProgram.id);
    const list = await request(app).get(`${api}/students`).set(bearer(da)).expect(200);
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0].email).toBe('own@test.edu');
    // Faculty and students hold student:read only for relationships: no list access.
    await request(app)
      .get(`${api}/students`)
      .set(bearer(await as('FACULTY')))
      .expect(403);
    await request(app)
      .get(`${api}/students`)
      .set(bearer(await as('STUDENT')))
      .expect(403);
  });

  it('keeps specializations within the program (service and database)', async () => {
    const { csProgram, meProgram } = await campusFixture();
    const otherSpec = await prisma.specialization.create({
      data: { programId: meProgram.id, code: 'X1', name: 'Other' },
    });
    const registrar = await as('ACADEMIC_ADMIN');
    await request(app)
      .post(`${api}/students`)
      .set(bearer(registrar))
      .send({
        email: 's@test.edu',
        firstName: 'S',
        lastName: 'T',
        programId: csProgram.id,
        specializationId: otherSpec.id,
        yearOfStudy: 1,
      })
      .expect(422);
    const { student } = await createStudentRecord(csProgram.id);
    await expect(
      prisma.student.update({
        where: { id: student.id },
        data: { specializationId: otherSpec.id },
      }),
    ).rejects.toThrow();
  });

  it('shows sensitive details only to the student and privileged admins', async () => {
    const { cs, csProgram } = await campusFixture();
    const { user, student } = await createStudentRecord(csProgram.id);
    await prisma.studentContact.create({
      data: { studentId: student.id, city: 'Pune', emergencyContactName: 'Parent' },
    });
    const registrar = await as('ACADEMIC_ADMIN');
    await prisma.registrationHold.create({
      data: {
        studentId: student.id,
        type: 'FINANCIAL',
        reason: 'Unpaid fees',
        placedById: registrar.userId,
      },
    });

    const self = await login(app, user.email);
    const mine = await request(app).get(`${api}/students/me`).set(bearer(self)).expect(200);
    expect(mine.body.data.contact.city).toBe('Pune');
    expect(mine.body.data.holds[0].reason).toBe('Unpaid fees');
    expect(mine.body.data.account).toBeNull();

    const reg = await request(app)
      .get(`${api}/students/${student.id}`)
      .set(bearer(registrar))
      .expect(200);
    expect(reg.body.data.contact.city).toBe('Pune');

    const da = await deptAdmin(cs.id);
    const dept = await request(app)
      .get(`${api}/students/${student.id}`)
      .set(bearer(da))
      .expect(200);
    expect(dept.body.data.contact).toBeNull();
    expect(dept.body.data.holds[0].reason).toBeNull();
    expect(dept.body.data.permissions).toMatchObject({ edit: true, readSensitive: false });
    await request(app)
      .patch(`${api}/students/${student.id}`)
      .set(bearer(da))
      .send({ contact: { city: 'Delhi' } })
      .expect(403);

    // Another student cannot see this record at all.
    await request(app)
      .get(`${api}/students/${student.id}`)
      .set(bearer(await as('STUDENT')))
      .expect(404);
  });

  it('lets students edit only permitted fields of their own record', async () => {
    const { csProgram } = await campusFixture();
    const { user } = await createStudentRecord(csProgram.id);
    const s = await login(app, user.email);
    const res = await request(app)
      .patch(`${api}/students/me`)
      .set(bearer(s))
      .send({
        phone: '+91 98450 11111',
        contact: { city: 'Mysuru', dateOfBirth: '1990-01-01' },
        yearOfStudy: 4,
      })
      .expect(200);
    expect(res.body.data).toMatchObject({
      phone: '+91 98450 11111',
      yearOfStudy: 1,
      contact: { city: 'Mysuru', dateOfBirth: null },
    });
  });

  it('changes programs with history and scope checks on both programs', async () => {
    const { cs, csProgram, meProgram } = await campusFixture();
    const otherCs = await createProgram(cs.id);
    const { student } = await createStudentRecord(csProgram.id);
    const da = await deptAdmin(cs.id);
    await request(app)
      .post(`${api}/students/${student.id}/change-program`)
      .set(bearer(da))
      .send({ programId: meProgram.id, reason: 'Transfer to mechanical' })
      .expect(403);
    await request(app)
      .post(`${api}/students/${student.id}/change-program`)
      .set(bearer(da))
      .send({ programId: csProgram.id, reason: 'No change at all' })
      .expect(422);
    const res = await request(app)
      .post(`${api}/students/${student.id}/change-program`)
      .set(bearer(da))
      .send({ programId: otherCs.id, reason: 'Moved to the honours track' })
      .expect(200);
    expect(res.body.data.program.id).toBe(otherCs.id);
    expect(res.body.data.programHistory[0]).toMatchObject({
      reason: 'Moved to the honours track',
      to: { code: otherCs.code },
    });
  });

  it('suspension locks the account and signs the student out; reactivation restores it', async () => {
    const { csProgram } = await campusFixture();
    const { user, student } = await createStudentRecord(csProgram.id);
    const s = await login(app, user.email);
    const registrar = await as('ACADEMIC_ADMIN');
    const res = await request(app)
      .post(`${api}/students/${student.id}/status`)
      .set(bearer(registrar))
      .send({ status: 'SUSPENDED', reason: 'Disciplinary committee decision' })
      .expect(200);
    expect(res.body.data).toMatchObject({
      status: 'SUSPENDED',
      account: { status: 'SUSPENDED', activeSessions: 0 },
    });
    await request(app).get(`${api}/auth/me`).set(bearer(s)).expect(401);
    const blocked = await request(app)
      .post(`${api}/auth/login`)
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_INACTIVE');

    await request(app)
      .post(`${api}/students/${student.id}/status`)
      .set(bearer(registrar))
      .send({ status: 'ACTIVE', reason: 'Suspension period ended' })
      .expect(200);
    await login(app, user.email);
  });

  it('places and releases holds', async () => {
    const { cs, csProgram } = await campusFixture();
    const { student } = await createStudentRecord(csProgram.id);
    const da = await deptAdmin(cs.id);
    const placed = await request(app)
      .post(`${api}/students/${student.id}/holds`)
      .set(bearer(da))
      .send({ type: 'DOCUMENTATION', reason: 'Missing transfer certificate' })
      .expect(201);
    expect(placed.body.data.activeHolds).toBe(1);
    await request(app)
      .post(`${api}/students/${student.id}/holds`)
      .set(bearer(da))
      .send({ type: 'DOCUMENTATION', reason: 'Again, same type' })
      .expect(409);
    const holdId = placed.body.data.holds[0].id;
    const released = await request(app)
      .post(`${api}/students/${student.id}/holds/${holdId}/release`)
      .set(bearer(da))
      .send({ note: 'Received' })
      .expect(200);
    expect(released.body.data.activeHolds).toBe(0);
    await request(app)
      .post(`${api}/students/${student.id}/holds/${holdId}/release`)
      .set(bearer(da))
      .send({})
      .expect(422);
    const filtered = await request(app)
      .get(`${api}/students?hasHold=true`)
      .set(bearer(da))
      .expect(200);
    expect(filtered.body.meta.total).toBe(0);
  });
});

describe('faculty', () => {
  it('creates faculty with generated employee numbers; students see directory fields only', async () => {
    const { cs, me } = await campusFixture();
    const registrar = await as('ACADEMIC_ADMIN');
    const res = await request(app)
      .post(`${api}/faculty`)
      .set(bearer(registrar))
      .send({
        email: 'prof@test.edu',
        firstName: 'Kavya',
        lastName: 'Iyer',
        departmentId: cs.id,
        secondaryDepartmentIds: [me.id],
        designation: 'ASSOCIATE_PROFESSOR',
        phone: '+91 80 1111',
        maxLoadCredits: 12,
      })
      .expect(201);
    expect(res.body.data).toMatchObject({
      employeeNumber: 'FAC00001',
      restricted: false,
      secondaryDepartments: [{ id: me.id }],
    });

    const student = await as('STUDENT');
    const view = await request(app)
      .get(`${api}/faculty/${res.body.data.id}`)
      .set(bearer(student))
      .expect(200);
    expect(view.body.data.restricted).toBe(true);
    expect(view.body.data).not.toHaveProperty('phone');
    expect(view.body.data).not.toHaveProperty('employeeNumber');
    const dir = await request(app)
      .get(`${api}/faculty/directory?q=iyer`)
      .set(bearer(student))
      .expect(200);
    expect(dir.body.data[0]).toMatchObject({
      lastName: 'Iyer',
      designation: 'ASSOCIATE_PROFESSOR',
    });
    await request(app).get(`${api}/faculty`).set(bearer(student)).expect(403);
  });

  it('heads and deans must belong to the unit; heads cannot be deactivated', async () => {
    const { school, cs, me } = await campusFixture();
    const { member: csProf } = await createFacultyRecord(cs.id);
    const { member: meProf } = await createFacultyRecord(me.id);
    const ua = await as('UNIVERSITY_ADMIN');
    await request(app)
      .patch(`${api}/departments/${cs.id}`)
      .set(bearer(ua))
      .send({ headId: meProf.id })
      .expect(422);
    const dept = await request(app)
      .patch(`${api}/departments/${cs.id}`)
      .set(bearer(ua))
      .send({ headId: csProf.id })
      .expect(200);
    expect(dept.body.data.head).toMatchObject({ id: csProf.id, designation: 'PROFESSOR' });
    const outsider = await createFacultyRecord((await createDepartment()).id);
    await request(app)
      .patch(`${api}/schools/${school.id}`)
      .set(bearer(ua))
      .send({ deanId: outsider.member.id })
      .expect(422);
    await request(app)
      .patch(`${api}/schools/${school.id}`)
      .set(bearer(ua))
      .send({ deanId: csProf.id })
      .expect(200);

    const blocked = await request(app)
      .patch(`${api}/faculty/${csProf.id}`)
      .set(bearer(ua))
      .send({ employmentStatus: 'INACTIVE' })
      .expect(422);
    expect(blocked.body.error.details.headOf).toEqual([cs.name]);
    const detail = await request(app)
      .get(`${api}/departments/${cs.id}`)
      .set(bearer(ua))
      .expect(200);
    expect(detail.body.data).toMatchObject({ facultyCount: 1 });
  });

  it('faculty edit only their own permitted profile fields', async () => {
    const { cs } = await campusFixture();
    const { user } = await createFacultyRecord(cs.id);
    const s = await login(app, user.email);
    const res = await request(app)
      .patch(`${api}/faculty/me`)
      .set(bearer(s))
      .send({ officeHours: 'Mon 10:00-12:00', designation: 'PROFESSOR', maxLoadCredits: 60 })
      .expect(200);
    expect(res.body.data).toMatchObject({
      officeHours: 'Mon 10:00-12:00',
      designation: 'PROFESSOR',
      maxLoadCredits: null,
    });
  });
});

describe('administrators and accounts', () => {
  it('creates scoped administrators within the escalation guard', async () => {
    const { cs } = await campusFixture();
    const ua = await as('UNIVERSITY_ADMIN');
    const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.key, r.id]));
    const res = await request(app)
      .post(`${api}/administrators`)
      .set(bearer(ua))
      .send({
        email: 'da@test.edu',
        firstName: 'Dee',
        lastName: 'Admin',
        roleId: roles.DEPARTMENT_ADMIN,
        scopeType: 'DEPARTMENT',
        scopeId: cs.id,
        jobTitle: 'Department coordinator',
      })
      .expect(201);
    expect(res.body.data.roles).toEqual([
      expect.objectContaining({ roleKey: 'DEPARTMENT_ADMIN', scopeName: 'Computer Science' }),
    ]);
    await request(app)
      .post(`${api}/administrators`)
      .set(bearer(ua))
      .send({
        email: 'sa@test.edu',
        firstName: 'S',
        lastName: 'A',
        roleId: roles.SUPER_ADMIN,
        scopeType: 'GLOBAL',
      })
      .expect(403);
    await request(app)
      .post(`${api}/administrators`)
      .set(bearer(ua))
      .send({
        email: 'f@test.edu',
        firstName: 'F',
        lastName: 'A',
        roleId: roles.FACULTY,
        scopeType: 'GLOBAL',
      })
      .expect(422);
    expect(
      await prisma.user.count({ where: { email: { in: ['sa@test.edu', 'f@test.edu'] } } }),
    ).toBe(0);
    await request(app)
      .get(`${api}/administrators`)
      .set(bearer(await deptAdmin(cs.id)))
      .expect(403);
    const list = await request(app).get(`${api}/administrators?q=dee`).set(bearer(ua)).expect(200);
    expect(list.body.data[0]).toMatchObject({
      email: 'da@test.edu',
      status: 'INVITED',
      jobTitle: 'Department coordinator',
    });
  });

  it('suspends and reactivates accounts with safeguards', async () => {
    const ua = await as('UNIVERSITY_ADMIN');
    const target = await createUser();
    const s = await login(app, target.email);
    await request(app)
      .post(`${api}/users/${target.id}/status`)
      .set(bearer(ua))
      .send({ status: 'SUSPENDED', reason: 'Security incident' })
      .expect(200);
    await request(app).get(`${api}/auth/me`).set(bearer(s)).expect(401);
    await request(app)
      .post(`${api}/users/${target.id}/status`)
      .set(bearer(ua))
      .send({ status: 'ACTIVE', reason: 'Incident closed' })
      .expect(200);
    await login(app, target.email);
    await request(app)
      .post(`${api}/users/${ua.userId}/status`)
      .set(bearer(ua))
      .send({ status: 'SUSPENDED', reason: 'Trying myself' })
      .expect(422);
    const sa = await createUser({ roles: ['SUPER_ADMIN'] });
    const res = await request(app)
      .post(`${api}/users/${sa.id}/status`)
      .set(bearer(ua))
      .send({ status: 'DEACTIVATED', reason: 'Last super admin' })
      .expect(422);
    expect(res.body.message).toMatch(/Super Administrator/);
  });

  it('scopes user role listings through student departments', async () => {
    const { cs, csProgram, meProgram } = await campusFixture();
    const own = await createStudentRecord(csProgram.id);
    const other = await createStudentRecord(meProgram.id);
    const da = await deptAdmin(cs.id);
    await request(app).get(`${api}/users/${own.user.id}/roles`).set(bearer(da)).expect(200);
    await request(app).get(`${api}/users/${other.user.id}/roles`).set(bearer(da)).expect(403);
  });

  it('includes permission scopes in /auth/me', async () => {
    const { cs } = await campusFixture();
    const me = await request(app)
      .get(`${api}/auth/me`)
      .set(bearer(await deptAdmin(cs.id)))
      .expect(200);
    expect(me.body.data.grants['department:manage']).toEqual([{ scope: 'DEPARTMENT', id: cs.id }]);
  });
});

describe('file uploads and avatars', () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  async function upload(s: { accessToken: string }, body: Buffer, mimeType = 'image/png') {
    const intent = await request(app)
      .post(`${api}/files/upload-intents`)
      .set(bearer(s))
      .send({ context: 'AVATAR', fileName: 'me.png', mimeType, sizeBytes: body.length })
      .expect(201);
    await request(app)
      .put(new URL(intent.body.data.upload.url).pathname)
      .set('Content-Type', mimeType)
      .send(body)
      .expect(204);
    return intent.body.data.fileId as string;
  }

  it('verifies content, sets the avatar, and rejects disguised files', async () => {
    const { csProgram } = await campusFixture();
    const { user } = await createStudentRecord(csProgram.id);
    const s = await login(app, user.email);
    await request(app)
      .post(`${api}/files/upload-intents`)
      .set(bearer(s))
      .send({ context: 'AVATAR', fileName: 'x.svg', mimeType: 'image/svg+xml', sizeBytes: 10 })
      .expect(422);
    await request(app)
      .post(`${api}/files/upload-intents`)
      .set(bearer(s))
      .send({
        context: 'AVATAR',
        fileName: 'x.png',
        mimeType: 'image/png',
        sizeBytes: 50 * 1024 * 1024,
      })
      .expect(422);

    const fake = await upload(s, Buffer.from('<html>definitely not a picture</html>'));
    const rejected = await request(app)
      .post(`${api}/files/${fake}/complete`)
      .set(bearer(s))
      .expect(422);
    expect(rejected.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');

    const real = await upload(s, PNG);
    await request(app).post(`${api}/files/${real}/complete`).set(bearer(s)).expect(200);
    const other = await login(app, (await createUser()).email);
    await request(app)
      .put(`${api}/me/avatar`)
      .set(bearer(other))
      .send({ fileId: real })
      .expect(404);
    const set = await request(app)
      .put(`${api}/me/avatar`)
      .set(bearer(s))
      .send({ fileId: real })
      .expect(200);
    expect(set.body.data.avatarUrl).toMatch(/\/api\/v1\/storage\/local\//);
    const img = await request(app).get(new URL(set.body.data.avatarUrl).pathname).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    const mine = await request(app).get(`${api}/students/me`).set(bearer(s)).expect(200);
    expect(mine.body.data.avatarUrl).toBeTruthy();
  });
});

describe('bulk import', () => {
  const csv = (rows: string[]) =>
    Buffer.from(
      ['email,first_name,last_name,program_code,specialization_code,year_of_study', ...rows].join(
        '\n',
      ),
    );

  it('previews CSV rows with per-row errors, then creates the valid ones', async () => {
    const { cs, csProgram, meProgram } = await campusFixture();
    await prisma.program.update({ where: { id: csProgram.id }, data: { code: 'BTECH-CS' } });
    await prisma.program.update({ where: { id: meProgram.id }, data: { code: 'BE-ME' } });
    await createUser({ email: 'taken@test.edu' });
    const user = await createUser();
    await grantScoped(user.id, 'ACADEMIC_ADMIN', { scopeType: 'DEPARTMENT', scopeId: cs.id });
    const s = await login(app, user.email);

    const preview = await request(app)
      .post(`${api}/imports/students/preview`)
      .set(bearer(s))
      .attach(
        'file',
        csv([
          'one@test.edu,Ravi,Kumar,btech-cs,,1',
          'two@test.edu,Sita,Ram,BTECH-CS,,2',
          'taken@test.edu,Dup,User,BTECH-CS,,1',
          'one@test.edu,Again,Dup,BTECH-CS,,1',
          'bad-email,No,Email,BTECH-CS,,1',
          'three@test.edu,Out,Ofscope,BE-ME,,1',
          'four@test.edu,No,Program,NOPE,,1',
          ',,,,,',
        ]),
        'students.csv',
      )
      .expect(201);
    expect(preview.body.data).toMatchObject({
      status: 'PREVIEW',
      totalRows: 7,
      validRows: 2,
      invalidRows: 5,
    });
    const id = preview.body.data.id;
    const invalid = await request(app)
      .get(`${api}/imports/${id}/rows?status=INVALID`)
      .set(bearer(s))
      .expect(200);
    const messages = Object.fromEntries(
      invalid.body.data.map((r: { rowNumber: number; errors: { message: string }[] }) => [
        r.rowNumber,
        r.errors.map((e) => e.message).join('; '),
      ]),
    );
    expect(messages).toEqual({
      4: 'An account with this email already exists',
      5: 'Duplicate of row 2',
      6: 'Enter a valid email',
      7: 'Outside your administrative scope',
      8: 'Unknown program NOPE',
    });

    await request(app)
      .post(`${api}/imports/${id}/commit`)
      .set(bearer(s))
      .send({ sendInvites: true })
      .expect(200);
    await processImportJob(id);
    const done = await request(app).get(`${api}/imports/${id}`).set(bearer(s)).expect(200);
    expect(done.body.data).toMatchObject({ status: 'COMPLETED', createdRows: 2, failedRows: 0 });
    expect(await prisma.student.count({ where: { programId: csProgram.id } })).toBe(2);
    expect((await emailJobs('invitation')).length).toBe(2);
    await request(app).post(`${api}/imports/${id}/commit`).set(bearer(s)).send({}).expect(422);
    // Other users cannot see someone else's import.
    await request(app)
      .get(`${api}/imports/${id}`)
      .set(bearer(await as('STUDENT')))
      .expect(404);
  });

  it('reads XLSX workbooks and rejects unknown columns and missing permission', async () => {
    const { cs } = await campusFixture();
    const registrar = await as('ACADEMIC_ADMIN');
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Faculty');
    sheet.addRow(['Email', 'First Name', 'Last Name', 'Department Code', 'Designation']);
    sheet.addRow(['k.iyer@test.edu', 'Kavya', 'Iyer', 'cs', 'Assistant Professor']);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const preview = await request(app)
      .post(`${api}/imports/faculty/preview`)
      .set(bearer(registrar))
      .attach('file', buffer, 'faculty.xlsx')
      .expect(201);
    expect(preview.body.data).toMatchObject({ kind: 'FACULTY', validRows: 1 });
    await request(app)
      .post(`${api}/imports/${preview.body.data.id}/commit`)
      .set(bearer(registrar))
      .send({ sendInvites: false })
      .expect(200);
    await processImportJob(preview.body.data.id);
    expect(
      await prisma.facultyMember.findFirst({
        where: { departmentId: cs.id },
        select: { designation: true },
      }),
    ).toEqual({ designation: 'ASSISTANT_PROFESSOR' });

    const bad = await request(app)
      .post(`${api}/imports/students/preview`)
      .set(bearer(registrar))
      .attach('file', Buffer.from('email,first_name,last_name,shoe_size\na@b.edu,A,B,9'), 'x.csv')
      .expect(422);
    expect(bad.body.message).toMatch(/Unknown columns: shoe_size/);
    await request(app)
      .post(`${api}/imports/students/preview`)
      .set(bearer(registrar))
      .attach('file', Buffer.from('hello'), 'x.pdf')
      .expect(422);
    // Department admins can create students but not bulk-import them.
    await request(app)
      .post(`${api}/imports/students/preview`)
      .set(bearer(await deptAdmin(cs.id)))
      .attach('file', csv(['a@b.edu,A,B,X,,1']), 's.csv')
      .expect(403);
  });
});
