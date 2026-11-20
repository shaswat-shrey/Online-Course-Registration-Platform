import { describe, expect, it } from 'vitest';
import {
  adminCreateSchema,
  facultyImportRowSchema,
  studentCreateSchema,
  studentImportRowSchema,
  studentSelfUpdateSchema,
} from './people.js';

const ID = '0196f000-0000-7000-8000-000000000001';

describe('people schemas', () => {
  it('normalises student input and defaults invitations on', () => {
    const v = studentCreateSchema.parse({
      email: ' Asha.Rao@Example.EDU ',
      firstName: 'Asha',
      lastName: 'Rao',
      studentNumber: '',
      programId: ID,
      yearOfStudy: 2,
      phone: '',
    });
    expect(v).toMatchObject({
      email: 'asha.rao@example.edu',
      studentNumber: null,
      phone: null,
      sendInvite: true,
    });
    expect(studentCreateSchema.safeParse({ ...v, phone: 'call me maybe' }).success).toBe(false);
  });

  it('never lets students change their own date of birth', () => {
    const v = studentSelfUpdateSchema.parse({
      phone: '+91 98450 00000',
      contact: { dateOfBirth: '2000-01-01', city: 'Pune' },
    });
    expect(v.contact).not.toHaveProperty('dateOfBirth');
    expect(v.contact.city).toBe('Pune');
  });

  it('requires a scope id exactly for scoped admin roles', () => {
    const base = { email: 'a@b.edu', firstName: 'A', lastName: 'B', roleId: ID };
    expect(adminCreateSchema.safeParse({ ...base, scopeType: 'GLOBAL' }).success).toBe(true);
    expect(adminCreateSchema.safeParse({ ...base, scopeType: 'DEPARTMENT' }).success).toBe(false);
    expect(adminCreateSchema.safeParse({ ...base, scopeType: 'GLOBAL', scopeId: ID }).success).toBe(
      false,
    );
  });

  it('parses spreadsheet cells for imports', () => {
    const row = studentImportRowSchema.parse({
      email: 'X@Y.EDU',
      first_name: 'Ravi',
      last_name: 'Kumar',
      program_code: 'btech-cs',
      year_of_study: 3,
      specialization_code: '',
    });
    expect(row).toMatchObject({
      email: 'x@y.edu',
      program_code: 'BTECH-CS',
      year_of_study: 3,
      specialization_code: null,
      student_number: null,
    });
    const bad = studentImportRowSchema.safeParse({
      email: '',
      first_name: 'A',
      last_name: 'B',
      program_code: 'P',
      year_of_study: 'two',
    });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues.map((i) => i.path[0])).toEqual(
      expect.arrayContaining(['email', 'year_of_study']),
    );
  });

  it('accepts human-friendly designations', () => {
    const row = facultyImportRowSchema.parse({
      email: 'f@u.edu',
      first_name: 'F',
      last_name: 'M',
      department_code: 'cs',
      designation: 'Associate professor',
    });
    expect(row.designation).toBe('ASSOCIATE_PROFESSOR');
    expect(facultyImportRowSchema.safeParse({ ...row, designation: 'Wizard' }).success).toBe(false);
  });
});
