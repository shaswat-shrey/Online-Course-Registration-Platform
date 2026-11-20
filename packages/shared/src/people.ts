import { z } from 'zod';
import { isoDate } from './structure.js';

/*
 * Input schemas for people management (SRS FR-USER-*). Shared by API and forms.
 */

export const STUDENT_STATUSES = [
  'ACTIVE',
  'ON_LEAVE',
  'SUSPENDED',
  'GRADUATED',
  'WITHDRAWN',
  'DISMISSED',
] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];
export const FACULTY_DESIGNATIONS = [
  'PROFESSOR',
  'ASSOCIATE_PROFESSOR',
  'ASSISTANT_PROFESSOR',
  'LECTURER',
  'SENIOR_LECTURER',
  'ADJUNCT',
  'VISITING',
  'EMERITUS',
] as const;
export type FacultyDesignation = (typeof FACULTY_DESIGNATIONS)[number];
export const EMPLOYMENT_STATUSES = ['ACTIVE', 'ON_LEAVE', 'INACTIVE'] as const;
export const HOLD_TYPES = [
  'FINANCIAL',
  'ACADEMIC',
  'DISCIPLINARY',
  'ADMINISTRATIVE',
  'DOCUMENTATION',
] as const;
export type HoldType = (typeof HOLD_TYPES)[number];
export const ACCOUNT_STATUSES = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email').max(254));
const personName = z.string().trim().min(1, 'Required').max(100);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .nullish()
  .transform((v) => (v ? v : null))
  .pipe(z.email('Enter a valid email').max(255).nullable());
const optionalId = z
  .union([z.uuid(), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? v : null));
const optionalDate = z
  .union([isoDate, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? v : null));
const phone = z
  .string()
  .trim()
  .max(50)
  .regex(/^[+()\d\s.-]*$/, 'Use digits, spaces and + ( ) - . only')
  .nullish()
  .transform((v) => (v ? v : null));
const identifier = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^([A-Z0-9][A-Z0-9-]{2,29})?$/, 'Use 3–30 letters, digits or hyphens')
  .nullish()
  .transform((v) => (v ? v : null));

/** Sensitive contact details (student_contacts). */
export const studentContactSchema = z.object({
  personalEmail: optionalEmail,
  dateOfBirth: optionalDate,
  addressLine: optionalText(300),
  city: optionalText(100),
  state: optionalText(100),
  postalCode: optionalText(20),
  country: optionalText(100),
  emergencyContactName: optionalText(150),
  emergencyContactPhone: phone,
  emergencyContactRelation: optionalText(50),
});
export type StudentContactInput = z.input<typeof studentContactSchema>;

export const studentCreateSchema = z.object({
  email,
  firstName: personName,
  lastName: personName,
  /** Leave empty to generate (e.g. 26CS0001). */
  studentNumber: identifier,
  programId: z.uuid('Choose a program'),
  specializationId: optionalId,
  admissionSessionId: optionalId,
  admissionDate: optionalDate,
  expectedGraduationYear: z
    .number()
    .int()
    .min(1950)
    .max(2200)
    .nullish()
    .transform((v) => v ?? null),
  yearOfStudy: z.number({ error: 'Enter a number' }).int().min(1).max(10),
  cohort: optionalText(50),
  phone,
  sendInvite: z.boolean().default(true),
  contact: studentContactSchema.optional(),
});
export type StudentCreateInput = z.input<typeof studentCreateSchema>;

export const studentUpdateSchema = z
  .object({
    firstName: personName,
    lastName: personName,
    admissionSessionId: optionalId,
    admissionDate: optionalDate,
    expectedGraduationYear: z
      .number()
      .int()
      .min(1950)
      .max(2200)
      .nullish()
      .transform((v) => v ?? null),
    yearOfStudy: z.number().int().min(1).max(10),
    cohort: optionalText(50),
    phone,
    contact: studentContactSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

/** What students may change themselves (FR-STUDENT-002). Date of birth stays admin-only. */
export const studentSelfUpdateSchema = z.object({
  phone,
  contact: studentContactSchema.omit({ dateOfBirth: true }),
});
export type StudentSelfUpdateInput = z.input<typeof studentSelfUpdateSchema>;

export const programChangeSchema = z.object({
  programId: z.uuid('Choose a program'),
  specializationId: optionalId,
  effectiveSessionId: optionalId,
  reason: z.string().trim().min(5, 'Explain the change (at least 5 characters)').max(500),
});
export type ProgramChangeInput = z.input<typeof programChangeSchema>;

export const studentStatusSchema = z.object({
  status: z.enum(STUDENT_STATUSES),
  reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500),
});

export const holdCreateSchema = z.object({
  type: z.enum(HOLD_TYPES),
  reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500),
});
export const holdReleaseSchema = z.object({ note: optionalText(500) });

const facultyFields = {
  departmentId: z.uuid('Choose a department'),
  secondaryDepartmentIds: z.array(z.uuid()).max(5).default([]),
  designation: z.enum(FACULTY_DESIGNATIONS),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES).optional(),
  qualifications: optionalText(1000),
  specialization: optionalText(200),
  researchInterests: optionalText(1000),
  officeLocation: optionalText(200),
  officeHours: optionalText(300),
  phone,
  maxLoadCredits: z
    .number()
    .min(0)
    .max(60)
    .nullish()
    .transform((v) => v ?? null),
  joinedOn: optionalDate,
};

export const facultyCreateSchema = z.object({
  email,
  firstName: personName,
  lastName: personName,
  /** Leave empty to generate (e.g. FAC00001). */
  employeeNumber: identifier,
  sendInvite: z.boolean().default(true),
  ...facultyFields,
});
export type FacultyCreateInput = z.input<typeof facultyCreateSchema>;

export const facultyUpdateSchema = z
  .object({ firstName: personName, lastName: personName, ...facultyFields })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

/** What faculty may change themselves (FR-FACULTY-002). */
export const facultySelfUpdateSchema = z.object({
  phone,
  officeLocation: facultyFields.officeLocation,
  officeHours: facultyFields.officeHours,
  qualifications: facultyFields.qualifications,
  specialization: facultyFields.specialization,
  researchInterests: facultyFields.researchInterests,
});
export type FacultySelfUpdateInput = z.input<typeof facultySelfUpdateSchema>;

export const adminCreateSchema = z
  .object({
    email,
    firstName: personName,
    lastName: personName,
    jobTitle: optionalText(150),
    employeeNumber: identifier,
    phone,
    officeDepartmentId: optionalId,
    roleId: z.uuid('Choose a role'),
    scopeType: z.enum(['GLOBAL', 'SCHOOL', 'DEPARTMENT']),
    scopeId: optionalId,
    sendInvite: z.boolean().default(true),
  })
  .refine((v) => (v.scopeType === 'GLOBAL') === !v.scopeId, {
    path: ['scopeId'],
    message: 'Choose a faculty or department for scoped roles (and none for university-wide)',
  });
export type AdminCreateInput = z.input<typeof adminCreateSchema>;

export const adminUpdateSchema = z
  .object({
    firstName: personName,
    lastName: personName,
    jobTitle: optionalText(150),
    phone,
    officeDepartmentId: optionalId,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const accountStatusSchema = z.object({
  status: z.enum(ACCOUNT_STATUSES),
  reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500),
});

// ----- files -------------------------------------------------------------------

export const FILE_LIMITS = {
  AVATAR: { maxBytes: 5 * 1024 * 1024, mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
  /** Course materials (FR-FILE-002): documents, slides, sheets, images and archives. */
  MATERIAL: {
    maxBytes: 50 * 1024 * 1024,
    mimeTypes: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/png',
      'image/jpeg',
      'image/webp',
      'application/zip',
    ],
  },
  /** Message and support-ticket attachments (FR-COMM-004/013). */
  MESSAGE: {
    maxBytes: 10 * 1024 * 1024,
    mimeTypes: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/png',
      'image/jpeg',
      'image/webp',
    ],
  },
  TICKET: {
    maxBytes: 10 * 1024 * 1024,
    mimeTypes: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/png',
      'image/jpeg',
      'image/webp',
    ],
  },
} as const;
export type UploadContext = keyof typeof FILE_LIMITS;

export const uploadIntentSchema = z.object({
  context: z.enum(Object.keys(FILE_LIMITS) as [UploadContext, ...UploadContext[]]),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(3).max(100),
  sizeBytes: z.number().int().positive(),
});
export type UploadIntentInput = z.infer<typeof uploadIntentSchema>;

export const setAvatarSchema = z.object({ fileId: z.uuid() });

// ----- bulk import rows (CSV/XLSX columns use snake_case headers) ------------------

/** Spreadsheet cells arrive as strings, numbers or nothing; normalise to trimmed text. */
const text = z.unknown().transform((v) => (v === undefined || v === null ? '' : String(v).trim()));
const requiredText = (label: string, max: number) =>
  text.pipe(z.string().min(1, `${label} is required`).max(max, `${label} is too long`));
const optionalTextCell = (max: number) =>
  text.pipe(z.string().max(max, 'Too long')).transform((v) => (v === '' ? null : v));
const upperCode = (label: string) => requiredText(label, 40).transform((v) => v.toUpperCase());
const optionalUpperCode = text
  .pipe(z.string().max(40))
  .transform((v) => (v === '' ? null : v.toUpperCase()));
const optionalIdentifierCell = text
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^([A-Z0-9][A-Z0-9-]{2,29})?$/, 'Use 3–30 letters, digits or hyphens'))
  .transform((v) => (v === '' ? null : v));
const phoneCell = text
  .pipe(
    z
      .string()
      .max(50)
      .regex(/^[+()\d\s.-]*$/, 'Use digits, spaces and + ( ) - . only'),
  )
  .transform((v) => (v === '' ? null : v));
const emailCell = requiredText('Email', 254)
  .transform((v) => v.toLowerCase())
  .pipe(z.email('Enter a valid email'));
const wholeNumberCell = (label: string, min: number, max: number) =>
  requiredText(label, 10)
    .transform((v) => Number(v))
    .pipe(
      z
        .number({ error: `${label} must be a number` })
        .int(`${label} must be a whole number`)
        .min(min)
        .max(max),
    );

export const STUDENT_IMPORT_COLUMNS = [
  'email',
  'first_name',
  'last_name',
  'student_number',
  'program_code',
  'specialization_code',
  'year_of_study',
  'admission_session_code',
  'cohort',
  'phone',
] as const;

/** Every known column is present (missing cells become empty strings) before validation. */
function withColumns<T extends z.ZodRawShape>(columns: readonly string[], shape: T) {
  return z.preprocess(
    (row) => ({
      ...Object.fromEntries(columns.map((c) => [c, ''])),
      ...(row as Record<string, unknown>),
    }),
    z.object(shape),
  );
}

export const studentImportRowSchema = withColumns(STUDENT_IMPORT_COLUMNS, {
  email: emailCell,
  first_name: requiredText('First name', 100),
  last_name: requiredText('Last name', 100),
  student_number: optionalIdentifierCell,
  program_code: upperCode('Program code'),
  specialization_code: optionalUpperCode,
  year_of_study: wholeNumberCell('Year of study', 1, 10),
  admission_session_code: optionalUpperCode,
  cohort: optionalTextCell(50),
  phone: phoneCell,
});
export type StudentImportRow = z.output<typeof studentImportRowSchema>;

export const FACULTY_IMPORT_COLUMNS = [
  'email',
  'first_name',
  'last_name',
  'employee_number',
  'department_code',
  'designation',
  'phone',
  'office_location',
  'max_load_credits',
] as const;

export const facultyImportRowSchema = withColumns(FACULTY_IMPORT_COLUMNS, {
  email: emailCell,
  first_name: requiredText('First name', 100),
  last_name: requiredText('Last name', 100),
  employee_number: optionalIdentifierCell,
  department_code: upperCode('Department code'),
  designation: requiredText('Designation', 40)
    .transform((v) => v.toUpperCase().replace(/[\s-]+/g, '_'))
    .pipe(z.enum(FACULTY_DESIGNATIONS, { error: 'Unknown designation' })),
  phone: phoneCell,
  office_location: optionalTextCell(200),
  max_load_credits: text
    .transform((v) => (v === '' ? null : Number(v)))
    .pipe(z.number({ error: 'Must be a number' }).min(0).max(60).nullable()),
});
export type FacultyImportRow = z.output<typeof facultyImportRowSchema>;

export const importCommitSchema = z.object({ sendInvites: z.boolean().default(true) });
