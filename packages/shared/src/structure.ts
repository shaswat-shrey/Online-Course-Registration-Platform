import { z } from 'zod';

/*
 * Input schemas for university structure and the academic calendar
 * (SRS FR-ORG-*, FR-CAL-*). Shared by API validation and admin forms.
 */

export const ENTITY_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];
export const DEGREE_LEVELS = ['DIPLOMA', 'UNDERGRADUATE', 'POSTGRADUATE', 'DOCTORAL'] as const;
export type DegreeLevel = (typeof DEGREE_LEVELS)[number];
export const COURSE_CATEGORIES = [
  'CORE',
  'ELECTIVE',
  'GENERAL_EDUCATION',
  'LABORATORY',
  'SEMINAR',
  'RESEARCH',
  'PROJECT',
  'INTERNSHIP',
  'PRACTICAL',
] as const;
export type CourseCategory = (typeof COURSE_CATEGORIES)[number];
export const REQUIREMENT_KINDS = [
  'ALL_OF',
  'CREDITS_FROM_LIST',
  'CREDITS_FROM_CATEGORY',
  'CREDITS_ANY',
] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];
export const SESSION_TYPES = [
  'FALL',
  'SPRING',
  'SUMMER',
  'WINTER',
  'TRIMESTER_1',
  'TRIMESTER_2',
  'TRIMESTER_3',
  'CUSTOM',
] as const;
export type SessionType = (typeof SESSION_TYPES)[number];
export const SESSION_STATUSES = ['PLANNED', 'ACTIVE', 'COMPLETED', 'ARCHIVED'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export const APPROVAL_MODES = ['NONE', 'ALL', 'CROSS_DEPARTMENT', 'LATE_ONLY'] as const;
export const PROMOTION_MODES = ['AUTO_ENROLL', 'OFFER'] as const;

// ----- field helpers --------------------------------------------------------

export const codeField = (max = 20) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'Use letters, digits, hyphens or underscores')
    .min(2, 'At least 2 characters')
    .max(max, `At most ${max} characters`);
const name = (max = 150) => z.string().trim().min(2, 'At least 2 characters').max(max);
/** Optional text: empty string → null so fields can be cleared. */
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
const optionalUrl = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null))
  .pipe(
    z
      .url({ protocol: /^https?$/, message: 'Enter a valid http(s) URL' })
      .max(255)
      .nullable(),
  );
const optionalId = z
  .union([z.uuid(), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? v : null));
/** Credits with at most one decimal place. */
const credits = (min: number, max: number) =>
  z
    .number({ error: 'Enter a number' })
    .min(min)
    .max(max)
    .refine((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9, 'Use at most one decimal place');
const optionalCredits = (max: number) =>
  credits(0, max)
    .nullish()
    .transform((v) => v ?? null);
export const isoDate = z.iso.date('Use the format YYYY-MM-DD');
export const isoDateTime = z.iso.datetime({ offset: true, message: 'Enter a valid date and time' });

/** Makes every field optional for PATCH while keeping transforms. */
function updateOf<T extends z.ZodRawShape>(shape: T) {
  return z
    .object(shape)
    .partial()
    .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
}

// ----- university & campuses ------------------------------------------------

export const universityUpdateSchema = updateOf({
  name: name(200),
  shortName: z.string().trim().min(2).max(50),
  timezone: z
    .string()
    .trim()
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Unknown time zone'),
  website: optionalUrl,
  contactEmail: optionalEmail,
  contactPhone: optionalText(50),
  address: optionalText(500),
  schoolLabel: z.enum(['Faculty', 'School']),
});

const campusShape = {
  code: codeField(),
  name: name(),
  address: optionalText(500),
  city: optionalText(100),
  status: z.enum(ENTITY_STATUSES).optional(),
};
export const campusCreateSchema = z.object(campusShape);
export const campusUpdateSchema = updateOf(campusShape);

// ----- schools & departments -------------------------------------------------

const schoolShape = {
  code: codeField(),
  name: name(),
  description: optionalText(2000),
  campusId: optionalId,
  contactEmail: optionalEmail,
  contactPhone: optionalText(50),
  website: optionalUrl,
  /** Dean: a faculty member of one of the school's departments. */
  deanId: optionalId,
  status: z.enum(ENTITY_STATUSES).optional(),
};
export const schoolCreateSchema = z.object(schoolShape);
export const schoolUpdateSchema = updateOf(schoolShape);
export type SchoolCreateInput = z.input<typeof schoolCreateSchema>;

const departmentShape = {
  code: codeField(),
  name: name(),
  description: optionalText(2000),
  schoolId: z.uuid('Choose a faculty/school'),
  campusId: optionalId,
  contactEmail: optionalEmail,
  contactPhone: optionalText(50),
  officeLocation: optionalText(200),
  /** Head of department: a faculty member of this department. */
  headId: optionalId,
  status: z.enum(ENTITY_STATUSES).optional(),
};
export const departmentCreateSchema = z.object(departmentShape);
export const departmentUpdateSchema = updateOf(departmentShape);
export type DepartmentCreateInput = z.input<typeof departmentCreateSchema>;

// ----- degrees, programs, specializations -----------------------------------

const degreeShape = {
  code: codeField(),
  name: name(),
  level: z.enum(DEGREE_LEVELS),
  description: optionalText(2000),
  status: z.enum(ENTITY_STATUSES).optional(),
};
export const degreeCreateSchema = z.object(degreeShape);
export const degreeUpdateSchema = updateOf(degreeShape);

const programShape = {
  code: codeField(30),
  name: name(200),
  description: optionalText(2000),
  degreeId: z.uuid('Choose a degree'),
  departmentId: z.uuid('Choose a department'),
  durationYears: z.number({ error: 'Enter a number' }).positive().max(10),
  sessionCount: z.number({ error: 'Enter a number' }).int().min(1).max(30),
  totalCredits: credits(0.5, 1000),
  minCoreCredits: optionalCredits(1000),
  minElectiveCredits: optionalCredits(1000),
  status: z.enum(ENTITY_STATUSES).optional(),
};
const programCreditsRule = (v: {
  totalCredits?: number;
  minCoreCredits?: number | null;
  minElectiveCredits?: number | null;
}) =>
  v.totalCredits === undefined ||
  (v.minCoreCredits ?? 0) + (v.minElectiveCredits ?? 0) <= v.totalCredits;
export const programCreateSchema = z.object(programShape).refine(programCreditsRule, {
  path: ['minCoreCredits'],
  message: 'Core + elective minimums exceed total credits',
});
export const programUpdateSchema = updateOf(programShape).refine(programCreditsRule, {
  path: ['minCoreCredits'],
  message: 'Core + elective minimums exceed total credits',
});
export type ProgramCreateInput = z.input<typeof programCreateSchema>;

const specializationShape = {
  code: codeField(30),
  name: name(200),
  description: optionalText(2000),
  additionalCredits: optionalCredits(500),
  status: z.enum(ENTITY_STATUSES).optional(),
};
export const specializationCreateSchema = z.object({
  ...specializationShape,
  programId: z.uuid('Choose a program'),
});
export const specializationUpdateSchema = updateOf(specializationShape);

const requirementShape = {
  name: name(150),
  description: optionalText(1000),
  kind: z.enum(REQUIREMENT_KINDS),
  minCredits: optionalCredits(1000),
  category: z
    .enum(COURSE_CATEGORIES)
    .nullish()
    .transform((v) => v ?? null),
  position: z.number().int().min(0).max(999).optional(),
};
const requirementRules = <
  T extends z.ZodType<{
    kind?: RequirementKind;
    minCredits?: number | null;
    category?: string | null;
  }>,
>(
  schema: T,
) =>
  schema
    .refine((v) => v.kind === undefined || (v.kind === 'CREDITS_FROM_CATEGORY') === !!v.category, {
      path: ['category'],
      message: 'A category is required for "credits from category" and not allowed otherwise',
    })
    .refine((v) => v.kind === undefined || v.kind === 'ALL_OF' || (v.minCredits ?? 0) > 0, {
      path: ['minCredits'],
      message: 'Credit-based requirements need a minimum number of credits',
    });
export const requirementGroupCreateSchema = requirementRules(z.object(requirementShape));
export const requirementGroupUpdateSchema = requirementRules(z.object(requirementShape));
export type RequirementGroupInput = z.input<typeof requirementGroupCreateSchema>;

// ----- academic calendar -----------------------------------------------------

const academicYearShape = {
  label: z
    .string()
    .trim()
    .regex(/^\d{4}[–-]\d{4}$/, 'Use the format 2026-2027'),
  startDate: isoDate,
  endDate: isoDate,
};
export const academicYearCreateSchema = z
  .object(academicYearShape)
  .refine((v) => v.startDate < v.endDate, {
    path: ['endDate'],
    message: 'End date must be after the start date',
  });
export const academicYearUpdateSchema = updateOf(academicYearShape);

const sessionShape = {
  academicYearId: z.uuid('Choose an academic year'),
  code: codeField(30),
  name: name(100),
  type: z.enum(SESSION_TYPES),
  startDate: isoDate,
  endDate: isoDate,
  gradingScaleId: optionalId,
};
export const academicSessionCreateSchema = z
  .object(sessionShape)
  .refine((v) => v.startDate < v.endDate, {
    path: ['endDate'],
    message: 'End date must be after the start date',
  });
export const academicSessionUpdateSchema = updateOf({
  code: sessionShape.code,
  name: sessionShape.name,
  type: sessionShape.type,
  startDate: sessionShape.startDate,
  endDate: sessionShape.endDate,
  gradingScaleId: sessionShape.gradingScaleId,
});
/** Lifecycle actions: PLANNED → ACTIVE → COMPLETED → ARCHIVED, plus current-session flag. */
export const sessionTransitionSchema = z.object({
  action: z.enum(['activate', 'complete', 'archive', 'make-current']),
});

export const sessionPolicySchema = z
  .object({
    minCredits: credits(0, 60),
    maxCredits: credits(0.5, 60),
    maxCreditsWithOverride: optionalCredits(80),
    approvalMode: z.enum(APPROVAL_MODES),
    waitlistEnabled: z.boolean(),
    waitlistMaxPerSection: z
      .number()
      .int()
      .min(0)
      .max(1000)
      .nullish()
      .transform((v) => v ?? null),
    promotionMode: z.enum(PROMOTION_MODES),
    offerWindowHours: z.number().int().min(1).max(336),
    countWaitlistInCredits: z.boolean(),
    allowInProgressPrereqs: z.boolean(),
    withdrawalRequiresApproval: z.boolean(),
  })
  .refine((v) => v.minCredits <= v.maxCredits, {
    path: ['minCredits'],
    message: 'Minimum exceeds maximum credits',
  })
  .refine((v) => v.maxCreditsWithOverride === null || v.maxCreditsWithOverride >= v.maxCredits, {
    path: ['maxCreditsWithOverride'],
    message: 'Override limit must be at least the normal maximum',
  });
export type SessionPolicyInput = z.input<typeof sessionPolicySchema>;

export const registrationPeriodSchema = z
  .object({
    opensAt: isoDateTime,
    closesAt: isoDateTime,
    lateClosesAt: isoDateTime.nullish().transform((v) => v ?? null),
    addDropDeadline: isoDateTime,
    withdrawalDeadline: isoDateTime,
  })
  .superRefine((v, ctx) => {
    const t = (s: string) => new Date(s).getTime();
    if (t(v.closesAt) <= t(v.opensAt))
      ctx.addIssue({
        code: 'custom',
        path: ['closesAt'],
        message: 'Must be after registration opens',
      });
    if (v.lateClosesAt && t(v.lateClosesAt) <= t(v.closesAt))
      ctx.addIssue({
        code: 'custom',
        path: ['lateClosesAt'],
        message: 'Must be after registration closes',
      });
    if (t(v.addDropDeadline) < t(v.closesAt))
      ctx.addIssue({
        code: 'custom',
        path: ['addDropDeadline'],
        message: 'Must be on or after registration closes',
      });
    if (t(v.withdrawalDeadline) < t(v.addDropDeadline))
      ctx.addIssue({
        code: 'custom',
        path: ['withdrawalDeadline'],
        message: 'Must be on or after the add/drop deadline',
      });
  });
export type RegistrationPeriodInput = z.input<typeof registrationPeriodSchema>;

export const priorityWindowSchema = z
  .object({
    name: name(100),
    opensAt: isoDateTime,
    programId: optionalId,
    yearOfStudy: z
      .number()
      .int()
      .min(1)
      .max(10)
      .nullish()
      .transform((v) => v ?? null),
    cohort: optionalText(50),
  })
  .refine((v) => v.programId || v.yearOfStudy || v.cohort, {
    path: ['programId'],
    message: 'Choose at least one of program, year of study or cohort',
  });
export type PriorityWindowInput = z.input<typeof priorityWindowSchema>;

export const gradeEntrySchema = z.object({
  letter: z.string().trim().min(1).max(5),
  minPercent: z.number().min(0).max(100),
  gradePoints: z
    .number()
    .min(0)
    .max(10)
    .nullish()
    .transform((v) => v ?? null),
  isPassing: z.boolean(),
  countsInGpa: z.boolean().default(true),
});
export const gradingScaleSchema = z
  .object({
    name: name(100),
    description: optionalText(1000),
    status: z.enum(ENTITY_STATUSES).optional(),
    entries: z.array(gradeEntrySchema).min(1, 'Add at least one grade').max(30),
  })
  .superRefine((v, ctx) => {
    const letters = v.entries.map((e) => e.letter.toUpperCase());
    if (new Set(letters).size !== letters.length)
      ctx.addIssue({ code: 'custom', path: ['entries'], message: 'Grade letters must be unique' });
    const percents = v.entries.map((e) => e.minPercent);
    if (new Set(percents).size !== percents.length)
      ctx.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'Minimum percentages must be unique',
      });
    if (!v.entries.some((e) => e.minPercent === 0))
      ctx.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'One grade must start at 0% so every score maps to a grade',
      });
    const withPoints = v.entries.filter((e) => e.gradePoints !== null).length;
    if (withPoints !== 0 && withPoints !== v.entries.length)
      ctx.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'Give every grade points, or none (pass/fail scales)',
      });
  });
export type GradingScaleInput = z.input<typeof gradingScaleSchema>;
