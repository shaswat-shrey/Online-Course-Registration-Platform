import { z } from 'zod';
import {
  codeField,
  COURSE_CATEGORIES,
  creditsField,
  ENTITY_STATUSES,
  nameField,
  optionalIdField,
  optionalTextField,
  partialUpdateOf,
  SESSION_TYPES,
} from './structure.js';

/*
 * Input schemas for courses, classrooms and sections (SRS FR-CRS-*).
 * Shared by API validation and admin forms.
 */

export const COURSE_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];
export const COURSE_MAPPING_TYPES = ['CORE', 'ELECTIVE'] as const;
export const RESTRICTION_MODES = ['INCLUDE', 'EXCLUDE'] as const;
export const RESTRICTION_TARGETS = [
  'DEPARTMENT',
  'PROGRAM',
  'SPECIALIZATION',
  'YEAR_OF_STUDY',
] as const;
export const CLASSROOM_TYPES = [
  'LECTURE_HALL',
  'CLASSROOM',
  'LABORATORY',
  'SEMINAR_ROOM',
  'COMPUTER_LAB',
  'AUDITORIUM',
  'STUDIO',
] as const;
export const SECTION_STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED', 'CANCELLED', 'COMPLETED'] as const;
export type SectionStatus = (typeof SECTION_STATUSES)[number];
export const MEETING_TYPES = ['LECTURE', 'LAB', 'TUTORIAL', 'SEMINAR', 'PRACTICAL'] as const;
export const INSTRUCTOR_ROLES = ['PRIMARY', 'SECONDARY', 'TA'] as const;
export const SECTION_ACTIONS = ['publish', 'close', 'reopen', 'cancel', 'complete'] as const;
export type SectionAction = (typeof SECTION_ACTIONS)[number];
/** Grade letters accepted as a prerequisite minimum (scale-independent label). */
export const GRADE_LETTER_PATTERN = /^[A-Z][+-]?$/;

const optionalInt = (min: number, max: number) =>
  z
    .number({ error: 'Enter a whole number' })
    .int('Enter a whole number')
    .min(min)
    .max(max)
    .nullish()
    .transform((v) => v ?? null);

// ----- courses ---------------------------------------------------------------

const outcomeList = z
  .array(z.string().trim().min(3, 'At least 3 characters').max(1000))
  .max(30, 'At most 30 outcomes');
const assessmentList = z
  .array(
    z.object({
      name: nameField(150),
      weight: z.number({ error: 'Enter a number' }).gt(0, 'Must be above 0').max(100),
    }),
  )
  .max(20, 'At most 20 components')
  .refine((list) => list.reduce((sum, c) => sum + c.weight, 0) <= 100.0001, {
    message: 'Weights add up to more than 100%',
  });

const courseShape = {
  code: codeField(20),
  title: nameField(200),
  description: optionalTextField(5000),
  departmentId: z.uuid('Choose a department'),
  credits: creditsField(0, 40),
  level: z
    .number({ error: 'Enter a number' })
    .int()
    .min(100, 'Between 100 and 900')
    .max(900, 'Between 100 and 900'),
  category: z.enum(COURSE_CATEGORIES),
  recommendedYear: optionalInt(1, 10),
  recommendedSessionType: z
    .enum(SESSION_TYPES)
    .nullish()
    .transform((v) => v ?? null),
  syllabus: optionalTextField(50_000),
  defaultCapacity: optionalInt(1, 2000),
  minEnrollment: optionalInt(0, 2000),
  coordinatorId: optionalIdField,
  isRepeatable: z.boolean().default(false),
  status: z.enum(COURSE_STATUSES).default('DRAFT'),
  outcomes: outcomeList.default([]),
  assessmentComponents: assessmentList.default([]),
};
const enrollmentRule = (v: { defaultCapacity?: number | null; minEnrollment?: number | null }) =>
  v.defaultCapacity == null || v.minEnrollment == null || v.minEnrollment <= v.defaultCapacity;
const enrollmentMessage = {
  path: ['minEnrollment'],
  message: 'Minimum enrollment cannot exceed the default capacity',
};
export const courseCreateSchema = z.object(courseShape).refine(enrollmentRule, enrollmentMessage);
export const courseUpdateSchema = partialUpdateOf({
  ...courseShape,
  isRepeatable: z.boolean(),
  status: z.enum(COURSE_STATUSES),
  outcomes: outcomeList,
  assessmentComponents: assessmentList,
}).refine(enrollmentRule, enrollmentMessage);
export type CourseInput = z.input<typeof courseCreateSchema>;

export const prerequisitesSchema = z.object({
  groups: z
    .array(
      z.object({
        items: z
          .array(
            z.object({
              courseId: z.uuid(),
              minGradeLetter: z
                .string()
                .trim()
                .toUpperCase()
                .nullish()
                .transform((v) => (v ? v : null))
                .pipe(
                  z
                    .string()
                    .regex(GRADE_LETTER_PATTERN, 'Use a grade letter such as C or B+')
                    .nullable(),
                ),
            }),
          )
          .min(1, 'Each group needs at least one course')
          .max(10)
          .refine((items) => new Set(items.map((i) => i.courseId)).size === items.length, {
            message: 'A course appears twice in the same group',
          }),
      }),
    )
    .max(10, 'At most 10 groups'),
});
export type PrerequisitesInput = z.input<typeof prerequisitesSchema>;

const uniqueIds = (max: number) =>
  z
    .array(z.uuid())
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Duplicate entries' });

export const corequisitesSchema = z.object({ courseIds: uniqueIds(10) });
export const courseProgramsSchema = z.object({
  mappings: z
    .array(z.object({ programId: z.uuid(), mappingType: z.enum(COURSE_MAPPING_TYPES) }))
    .max(100)
    .refine((m) => new Set(m.map((x) => x.programId)).size === m.length, {
      message: 'A program appears twice',
    }),
});
export const courseSpecializationsSchema = z.object({
  mappings: z
    .array(z.object({ specializationId: z.uuid(), mappingType: z.enum(COURSE_MAPPING_TYPES) }))
    .max(100)
    .refine((m) => new Set(m.map((x) => x.specializationId)).size === m.length, {
      message: 'A specialization appears twice',
    }),
});

const restrictionSchema = z
  .object({
    mode: z.enum(RESTRICTION_MODES),
    targetType: z.enum(RESTRICTION_TARGETS),
    targetId: optionalIdField,
    targetValue: optionalInt(1, 10),
  })
  .refine(
    (r) =>
      r.targetType === 'YEAR_OF_STUDY'
        ? r.targetValue !== null && r.targetId === null
        : r.targetId !== null && r.targetValue === null,
    { message: 'Choose a target that matches the restriction type', path: ['targetId'] },
  );
export const restrictionsSchema = z.object({
  restrictions: z.array(restrictionSchema).max(50),
});
export type RestrictionInput = z.input<typeof restrictionSchema>;

export const requirementCoursesSchema = z.object({ courseIds: uniqueIds(200) });

// ----- classrooms ------------------------------------------------------------

const classroomShape = {
  campusId: z.uuid('Choose a campus'),
  building: nameField(100),
  roomNumber: z.string().trim().min(1, 'Required').max(30),
  name: optionalTextField(150),
  capacity: z.number({ error: 'Enter a number' }).int().min(1).max(5000),
  type: z.enum(CLASSROOM_TYPES),
  equipment: z
    .array(z.string().trim().min(1).max(50))
    .max(30)
    .default([])
    .transform((list) => [...new Set(list)]),
  status: z.enum(ENTITY_STATUSES).default('ACTIVE'),
};
export const classroomCreateSchema = z.object(classroomShape);
export const classroomUpdateSchema = partialUpdateOf({
  ...classroomShape,
  equipment: z
    .array(z.string().trim().min(1).max(50))
    .max(30)
    .transform((list) => [...new Set(list)]),
  status: z.enum(ENTITY_STATUSES),
});

// ----- sections --------------------------------------------------------------

export const sectionCodeField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{0,19}$/, 'Use letters, digits or hyphens (e.g. A, 01, LAB-1)');

const sectionShape = {
  sectionCode: sectionCodeField,
  capacity: z.number({ error: 'Enter a number' }).int().min(1, 'At least 1').max(2000),
  waitlistCapacity: z.number({ error: 'Enter a number' }).int().min(0).max(1000).default(0),
  campusId: optionalIdField,
  registrationOpen: z.boolean().default(true),
  notes: optionalTextField(2000),
};
export const sectionCreateSchema = z.object({
  courseId: z.uuid('Choose a course'),
  sessionId: z.uuid('Choose a session'),
  ...sectionShape,
});
export const sectionUpdateSchema = partialUpdateOf({
  ...sectionShape,
  waitlistCapacity: z.number({ error: 'Enter a number' }).int().min(0).max(1000),
  registrationOpen: z.boolean(),
});

/** Explicit acknowledgement for saving despite conflicts (FR-CRS-007/008). */
export const conflictOverrideSchema = z
  .object({ reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500) })
  .nullish()
  .transform((v) => v ?? null);

const meetingSchema = z
  .object({
    dayOfWeek: z.number().int().min(1).max(7),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
    type: z.enum(MEETING_TYPES).default('LECTURE'),
    classroomId: optionalIdField,
  })
  .refine((m) => m.endMinute > m.startMinute, {
    path: ['endMinute'],
    message: 'Ends before it starts',
  });
export type MeetingInput = z.input<typeof meetingSchema>;

/** Same day and `startA < endB && startB < endA` (BR-018); back-to-back is fine. */
export function meetingsOverlap(
  a: { dayOfWeek: number; startMinute: number; endMinute: number },
  b: { dayOfWeek: number; startMinute: number; endMinute: number },
): boolean {
  return a.dayOfWeek === b.dayOfWeek && a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

export const sectionMeetingsSchema = z.object({
  meetings: z
    .array(meetingSchema)
    .max(20)
    .refine((list) => !list.some((m, i) => list.some((o, j) => j > i && meetingsOverlap(m, o))), {
      message: 'Two meetings of this section overlap',
    }),
  override: conflictOverrideSchema,
});

export const sectionInstructorsSchema = z.object({
  instructors: z
    .array(z.object({ facultyMemberId: z.uuid(), role: z.enum(INSTRUCTOR_ROLES) }))
    .max(10)
    .refine((l) => new Set(l.map((i) => i.facultyMemberId)).size === l.length, {
      message: 'An instructor appears twice',
    })
    .refine((l) => l.filter((i) => i.role === 'PRIMARY').length <= 1, {
      message: 'Only one primary instructor',
    }),
  override: conflictOverrideSchema,
});

export const sectionTransitionSchema = z
  .object({
    action: z.enum(SECTION_ACTIONS),
    reason: z
      .string()
      .trim()
      .max(500)
      .nullish()
      .transform((v) => (v ? v : null)),
  })
  .refine((v) => v.action !== 'cancel' || (v.reason?.length ?? 0) >= 5, {
    path: ['reason'],
    message: 'Give a reason for cancelling (at least 5 characters)',
  });

export const rollForwardSchema = z
  .object({
    fromSessionId: z.uuid('Choose the session to copy from'),
    toSessionId: z.uuid('Choose the session to copy into'),
    departmentId: optionalIdField,
    includeInstructors: z.boolean().default(true),
  })
  .refine((v) => v.fromSessionId !== v.toSessionId, {
    path: ['toSessionId'],
    message: 'Choose a different session',
  });

/** "09:30" ↔ 570 helpers for meeting editors. */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export function timeToMinutes(time: string): number | null {
  const match = /^([01]\d|2[0-4]):([0-5]\d)$/.exec(time);
  if (!match) return null;
  const total = Number(match[1]) * 60 + Number(match[2]);
  return total <= 1440 ? total : null;
}
