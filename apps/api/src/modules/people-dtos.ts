import { z } from 'zod';

/** OpenAPI response shapes for people modules (loose where nested detail varies by viewer). */
const ref = z.object({ id: z.uuid(), name: z.string() });
const coded = ref.extend({ code: z.string() });
export const accountDto = z
  .object({
    status: z.string(),
    lastLoginAt: z.string().nullable(),
    locked: z.boolean(),
    activated: z.boolean(),
    activeSessions: z.number(),
    mfaEnabled: z.boolean(),
    createdAt: z.string(),
  })
  .meta({ id: 'AccountSummary' });

export const studentListItemDto = z
  .object({
    id: z.uuid(),
    studentNumber: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    program: coded,
    department: coded,
    specialization: z.object({ code: z.string(), name: z.string() }).nullable(),
    yearOfStudy: z.number(),
    status: z.string(),
    accountStatus: z.string(),
    activeHolds: z.number(),
  })
  .meta({ id: 'StudentListItem' });

export const studentDetailDto = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    studentNumber: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    avatarUrl: z.string().nullable(),
    program: coded.extend({ totalCredits: z.number() }),
    department: coded.extend({ schoolId: z.uuid() }),
    specialization: coded.nullable(),
    admissionSession: coded.nullable(),
    admissionDate: z.string().nullable(),
    expectedGraduationYear: z.number().nullable(),
    yearOfStudy: z.number(),
    cohort: z.string().nullable(),
    status: z.string(),
    phone: z.string().nullable(),
    contact: z
      .record(z.string(), z.string().nullable())
      .nullable()
      .describe('Only for the student and admins with student:read_sensitive'),
    activeHolds: z.number(),
    holds: z.array(z.record(z.string(), z.unknown())),
    programHistory: z.array(z.record(z.string(), z.unknown())),
    account: accountDto.nullable(),
    permissions: z.object({
      edit: z.boolean(),
      manageHolds: z.boolean(),
      readSensitive: z.boolean(),
      manageAccount: z.boolean(),
    }),
    createdAt: z.string(),
  })
  .meta({ id: 'StudentDetail' });

export const facultyListItemDto = z
  .object({
    id: z.uuid(),
    employeeNumber: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    designation: z.string(),
    department: coded,
    employmentStatus: z.string(),
    accountStatus: z.string(),
    headOf: z.array(ref),
  })
  .meta({ id: 'FacultyListItem' });

export const facultyDirectoryDto = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    avatarUrl: z.string().nullable(),
    designation: z.string(),
    department: coded,
    secondaryDepartments: z.array(coded),
    specialization: z.string().nullable(),
    researchInterests: z.string().nullable(),
    qualifications: z.string().nullable(),
    officeLocation: z.string().nullable(),
    officeHours: z.string().nullable(),
    headOf: z.array(ref),
    deanOf: z.array(ref),
  })
  .meta({ id: 'FacultyDirectoryEntry' });

export const facultyDetailDto = facultyDirectoryDto
  .extend({
    restricted: z.boolean().describe('true: only directory fields are included'),
    employeeNumber: z.string().optional(),
    employmentStatus: z.string().optional(),
    phone: z.string().nullable().optional(),
    maxLoadCredits: z.number().nullable().optional(),
    joinedOn: z.string().nullable().optional(),
    account: accountDto.nullable().optional(),
    permissions: z.object({ edit: z.boolean(), manageAccount: z.boolean() }).optional(),
  })
  .meta({ id: 'FacultyDetail' });

const adminRole = z.object({
  id: z.uuid(),
  roleKey: z.string(),
  roleName: z.string(),
  scopeType: z.string(),
  scopeName: z.string().nullable(),
});
export const adminListItemDto = z
  .object({
    id: z.uuid(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    status: z.string(),
    jobTitle: z.string().nullable(),
    roles: z.array(adminRole),
    lastLoginAt: z.string().nullable(),
  })
  .meta({ id: 'AdministratorListItem' });
export const adminDetailDto = adminListItemDto
  .omit({ status: true, lastLoginAt: true })
  .extend({
    avatarUrl: z.string().nullable(),
    employeeNumber: z.string().nullable(),
    phone: z.string().nullable(),
    officeDepartment: ref.nullable(),
    account: accountDto,
  })
  .meta({ id: 'AdministratorDetail' });
