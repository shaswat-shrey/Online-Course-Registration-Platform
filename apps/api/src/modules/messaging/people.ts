import type { Portal } from '@ucrams/shared';
import { prisma } from '../../infrastructure/database/prisma.js';

/** What a user is to the communication rules (FR-COMM-002). */
export interface Person {
  id: string;
  name: string;
  email: string;
  active: boolean;
  /** Holds an organisational (administrator) role. */
  isAdmin: boolean;
  student: {
    programId: string;
    specializationId: string | null;
    departmentId: string;
    schoolId: string;
    yearOfStudy: number;
  } | null;
  faculty: { departmentId: string; schoolId: string } | null;
}

export type PersonKind = 'STUDENT' | 'FACULTY' | 'ADMIN';

export const kindOf = (p: Person): PersonKind =>
  p.student ? 'STUDENT' : p.faculty ? 'FACULTY' : 'ADMIN';

/** The portal links in notifications to this person should open. */
export const portalOf = (p: Person): Portal =>
  p.student ? 'student' : p.faculty ? 'faculty' : 'admin';

/** Department the person belongs to (student programme or faculty home department). */
export const departmentOf = (p: Person) =>
  p.student
    ? { departmentId: p.student.departmentId, schoolId: p.student.schoolId }
    : p.faculty
      ? { departmentId: p.faculty.departmentId, schoolId: p.faculty.schoolId }
      : null;

export async function loadPeople(ids: string[]): Promise<Map<string, Person>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      status: true,
      roles: { select: { role: { select: { scopeMode: true } } } },
      student: {
        select: {
          programId: true,
          specializationId: true,
          yearOfStudy: true,
          program: { select: { departmentId: true, department: { select: { schoolId: true } } } },
        },
      },
      facultyMember: {
        select: { departmentId: true, department: { select: { schoolId: true } } },
      },
    },
  });
  return new Map(
    users.map((u) => [
      u.id,
      {
        id: u.id,
        name: `${u.firstName} ${u.lastName}`,
        email: u.email,
        active: u.status === 'ACTIVE',
        isAdmin: u.roles.some((r) => r.role.scopeMode === 'ORGANIZATIONAL'),
        student: u.student
          ? {
              programId: u.student.programId,
              specializationId: u.student.specializationId,
              departmentId: u.student.program.departmentId,
              schoolId: u.student.program.department.schoolId,
              yearOfStudy: u.student.yearOfStudy,
            }
          : null,
        faculty: u.facultyMember
          ? {
              departmentId: u.facultyMember.departmentId,
              schoolId: u.facultyMember.department.schoolId,
            }
          : null,
      },
    ]),
  );
}

export async function loadPerson(id: string): Promise<Person | null> {
  return (await loadPeople([id])).get(id) ?? null;
}

/** Sessions whose sections count as "current" for contact rules: running or upcoming. */
export const CURRENT_SESSION = {
  status: { in: ['ACTIVE', 'PLANNED'] as Array<'ACTIVE' | 'PLANNED'> },
};
export const RUNNING_SECTION = { in: ['PUBLISHED', 'CLOSED'] as Array<'PUBLISHED' | 'CLOSED'> };
export const SEAT_HOLDING = ['REGISTERED', 'PENDING'] as const;

/** True when the faculty user teaches a current section the student holds a seat in. */
export async function sharesCurrentSection(facultyUserId: string, studentUserId: string) {
  const n = await prisma.sectionInstructor.count({
    where: {
      facultyMember: { userId: facultyUserId },
      section: {
        status: RUNNING_SECTION,
        session: CURRENT_SESSION,
        registrations: {
          some: { status: { in: [...SEAT_HOLDING] }, student: { userId: studentUserId } },
        },
      },
    },
  });
  return n > 0;
}

/**
 * FR-COMM-002: administrators may message anyone; faculty and administrators
 * may message each other; faculty and students only within a current section
 * they share. Students reach administrators through the support inbox and
 * never message each other.
 */
export async function canContact(me: Person, them: Person): Promise<boolean> {
  if (me.id === them.id || !them.active) return false;
  if (me.isAdmin) return true;
  if (them.isAdmin) return !!me.faculty;
  if (me.faculty && them.student) return sharesCurrentSection(me.id, them.id);
  if (me.student && them.faculty) return sharesCurrentSection(them.id, me.id);
  return false;
}
