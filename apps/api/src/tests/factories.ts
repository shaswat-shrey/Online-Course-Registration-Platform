import type { Express } from 'express';
import request, { type Response } from 'supertest';
import { AUTH_COOKIE, CSRF_HEADER, type RoleKey } from '@ucrams/shared';
import { prisma } from '../infrastructure/database/prisma.js';
import { hashPassword } from '../modules/auth/password.js';

export const TEST_PASSWORD = 'Correct-Horse-Battery-9';
let counter = 0;
let cachedHash: string | undefined;

export async function createUser(
  options: {
    roles?: RoleKey[];
    status?: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
    email?: string;
    password?: string | null;
  } = {},
) {
  counter += 1;
  const password = options.password === undefined ? TEST_PASSWORD : options.password;
  cachedHash ??= await hashPassword(TEST_PASSWORD);
  const passwordHash =
    password === null
      ? null
      : password === TEST_PASSWORD
        ? cachedHash
        : await hashPassword(password);
  const roles = await prisma.role.findMany({ where: { key: { in: options.roles ?? [] } } });
  return prisma.user.create({
    data: {
      email: options.email ?? `user${counter}-${Date.now()}@test.edu`,
      firstName: 'Test',
      lastName: `User${counter}`,
      passwordHash,
      status: options.status ?? 'ACTIVE',
      roles: { create: roles.map((r) => ({ roleId: r.id, scopeType: 'GLOBAL' as const })) },
    },
  });
}

/** Extracts a cookie value from a response's Set-Cookie headers. */
export function cookieValue(res: Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const line = raw?.find((c) => c.startsWith(`${name}=`));
  if (!line) return undefined;
  return decodeURIComponent(line.split(';')[0]!.slice(name.length + 1));
}

export function setCookieLine(res: Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith(`${name}=`));
}

export interface TestSession {
  accessToken: string;
  refreshToken: string;
  csrf: string;
  sessionId: string;
  /** Cookie header for cookie-authenticated endpoints. */
  cookie: string;
}

export function sessionFrom(res: Response, previous?: TestSession): TestSession {
  const refreshToken = cookieValue(res, AUTH_COOKIE.refresh) ?? previous!.refreshToken;
  const csrf = cookieValue(res, AUTH_COOKIE.csrf) ?? previous!.csrf;
  return {
    accessToken: res.body.data.accessToken,
    refreshToken,
    csrf,
    sessionId: res.body.data.me?.sessionId ?? previous?.sessionId,
    cookie: `${AUTH_COOKIE.refresh}=${refreshToken}; ${AUTH_COOKIE.csrf}=${csrf}`,
  };
}

export async function login(
  app: Express,
  email: string,
  password = TEST_PASSWORD,
): Promise<TestSession> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
  return sessionFrom(res);
}

export function refreshRequest(app: Express, s: Pick<TestSession, 'cookie' | 'csrf'>) {
  return request(app).post('/api/v1/auth/refresh').set('Cookie', s.cookie).set(CSRF_HEADER, s.csrf);
}

export const bearer = (s: { accessToken: string }) => ({
  Authorization: `Bearer ${s.accessToken}`,
});

// ----- structure ------------------------------------------------------------

let structureCounter = 0;
const nextCode = (prefix: string) => `${prefix}${++structureCounter}`;

export async function createSchool(overrides: { status?: 'ACTIVE' | 'INACTIVE' } = {}) {
  return prisma.school.create({
    data: { code: nextCode('SCH'), name: `School ${structureCounter}`, ...overrides },
  });
}

export async function createDepartment(
  schoolId?: string,
  overrides: { status?: 'ACTIVE' | 'INACTIVE' } = {},
) {
  const school = schoolId ?? (await createSchool()).id;
  return prisma.department.create({
    data: {
      code: nextCode('DEP'),
      name: `Department ${structureCounter}`,
      schoolId: school,
      ...overrides,
    },
  });
}

export async function createDegree(overrides: { status?: 'ACTIVE' | 'INACTIVE' } = {}) {
  return prisma.degree.create({
    data: {
      code: nextCode('DEG'),
      name: `Degree ${structureCounter}`,
      level: 'UNDERGRADUATE',
      ...overrides,
    },
  });
}

export async function createProgram(
  departmentId: string,
  overrides: { totalCredits?: number } = {},
) {
  const degree = await createDegree();
  return prisma.program.create({
    data: {
      code: nextCode('PRG'),
      name: `Program ${structureCounter}`,
      degreeId: degree.id,
      departmentId,
      durationYears: 4,
      sessionCount: 8,
      totalCredits: overrides.totalCredits ?? 160,
    },
  });
}

/** Adds a scoped role assignment to an existing user. */
export async function grantScoped(
  userId: string,
  role: RoleKey,
  scope: { scopeType: 'SCHOOL' | 'DEPARTMENT'; scopeId: string },
) {
  const r = await prisma.role.findUniqueOrThrow({ where: { key: role } });
  await prisma.userRole.create({ data: { userId, roleId: r.id, ...scope } });
}

// ----- people -----------------------------------------------------------------

/** A student record (with an ACTIVE account) in the given program. */
export async function createStudentRecord(
  programId: string,
  options: { email?: string; yearOfStudy?: number } = {},
) {
  const user = await createUser({ roles: ['STUDENT'], email: options.email });
  counter += 1;
  const student = await prisma.student.create({
    data: {
      userId: user.id,
      studentNumber: `TS${Date.now().toString().slice(-6)}${counter}`,
      programId,
      yearOfStudy: options.yearOfStudy ?? 1,
    },
  });
  return { user, student };
}

export async function createFacultyRecord(
  departmentId: string,
  overrides: { designation?: 'PROFESSOR' | 'LECTURER' } = {},
) {
  const user = await createUser({ roles: ['FACULTY'] });
  counter += 1;
  const member = await prisma.facultyMember.create({
    data: {
      userId: user.id,
      employeeNumber: `TF${Date.now().toString().slice(-6)}${counter}`,
      departmentId,
      designation: overrides.designation ?? 'PROFESSOR',
    },
  });
  return { user, member };
}

// ----- catalog ----------------------------------------------------------------

export async function createSession(
  overrides: { status?: 'PLANNED' | 'ACTIVE' | 'COMPLETED'; code?: string } = {},
) {
  counter += 1;
  const year = await prisma.academicYear.create({
    data: {
      label: `${2000 + counter}-${2001 + counter}`,
      startDate: new Date('2026-07-01'),
      endDate: new Date('2027-06-30'),
    },
  });
  return prisma.academicSession.create({
    data: {
      academicYearId: year.id,
      code: overrides.code ?? `SES${counter}`,
      name: `Session ${counter}`,
      type: 'FALL',
      startDate: new Date('2026-08-03'),
      endDate: new Date('2026-12-18'),
      status: overrides.status ?? 'ACTIVE',
    },
  });
}

export async function createCourse(
  departmentId: string,
  overrides: { code?: string; status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE'; credits?: number } = {},
) {
  return prisma.course.create({
    data: {
      code: overrides.code ?? nextCode('CRS'),
      title: `Course ${structureCounter}`,
      departmentId,
      credits: overrides.credits ?? 4,
      level: 100,
      category: 'CORE',
      status: overrides.status ?? 'ACTIVE',
    },
  });
}

export async function createClassroom(overrides: { capacity?: number } = {}) {
  const campus =
    (await prisma.campus.findFirst()) ??
    (await prisma.campus.create({ data: { code: 'MAIN', name: 'Main Campus' } }));
  return prisma.classroom.create({
    data: {
      campusId: campus.id,
      building: 'Block A',
      roomNumber: nextCode('R'),
      capacity: overrides.capacity ?? 60,
      type: 'CLASSROOM',
    },
  });
}

export async function createSection(
  courseId: string,
  sessionId: string,
  overrides: {
    sectionCode?: string;
    status?: 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'CANCELLED';
    capacity?: number;
    meetings?: Array<{
      dayOfWeek: number;
      startMinute: number;
      endMinute: number;
      classroomId?: string;
    }>;
    instructorId?: string;
  } = {},
) {
  return prisma.courseSection.create({
    data: {
      courseId,
      sessionId,
      sectionCode: overrides.sectionCode ?? 'A',
      capacity: overrides.capacity ?? 40,
      status: overrides.status ?? 'DRAFT',
      meetings: overrides.meetings ? { create: overrides.meetings } : undefined,
      instructors: overrides.instructorId
        ? { create: [{ facultyMemberId: overrides.instructorId, role: 'PRIMARY' }] }
        : undefined,
    },
  });
}
