import { z } from 'zod';

/*
 * Academic management inputs (SRS FR-ACAD-001..009): attendance, assessments,
 * final grades, grade changes and GPA settings.
 */

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ASSESSMENT_TYPES = ['ASSIGNMENT', 'QUIZ', 'EXAM', 'PROJECT', 'LAB', 'OTHER'] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];
export const GRADE_SUBMISSION_STATUSES = ['DRAFT', 'SUBMITTED', 'RETURNED', 'POSTED'] as const;
export type GradeSubmissionStatus = (typeof GRADE_SUBMISSION_STATUSES)[number];
export const GPA_REPEAT_POLICIES = ['ALL', 'LATEST', 'BEST'] as const;
export type GpaRepeatPolicy = (typeof GPA_REPEAT_POLICIES)[number];

const isoDate = z.iso.date('Use YYYY-MM-DD');
const note = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

// ----- attendance (FR-ACAD-003) ---------------------------------------------------

export const attendanceSessionCreateSchema = z.object({
  date: isoDate,
  startMinute: z
    .number()
    .int()
    .min(0)
    .max(1439)
    .nullish()
    .transform((v) => v ?? null),
  topic: note(200),
});
export type AttendanceSessionInput = z.input<typeof attendanceSessionCreateSchema>;

export const attendanceRecordsSchema = z.object({
  records: z
    .array(
      z.object({
        studentId: z.uuid(),
        status: z.enum(ATTENDANCE_STATUSES),
        note: note(300),
      }),
    )
    .min(1)
    .max(500)
    .refine((r) => new Set(r.map((x) => x.studentId)).size === r.length, {
      message: 'A student appears twice',
    }),
});

export const attendanceSettingsSchema = z.object({ enabled: z.boolean() });

// ----- assessments (FR-ACAD-004) ------------------------------------------------------

const weight = z.number().gt(0, 'Weight must be above 0').max(100, 'At most 100');
const maxScore = z.number().gt(0, 'Maximum score must be above 0').max(9999);

export const assessmentCreateSchema = z.object({
  title: z.string().trim().min(2, 'At least 2 characters').max(200),
  type: z.enum(ASSESSMENT_TYPES),
  weight,
  maxScore,
  dueAt: z.iso
    .datetime({ offset: true })
    .nullish()
    .transform((v) => v ?? null),
});
export type AssessmentInput = z.input<typeof assessmentCreateSchema>;

export const assessmentUpdateSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    type: z.enum(ASSESSMENT_TYPES),
    weight,
    maxScore,
    dueAt: z.iso.datetime({ offset: true }).nullable(),
    /** Publishing shows the component and its scores to students. */
    published: z.boolean(),
    position: z.number().int().min(0).max(1000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const assessmentScoresSchema = z.object({
  scores: z
    .array(
      z
        .object({
          studentId: z.uuid(),
          score: z.number().min(0).max(9999).nullable(),
          excused: z.boolean().default(false),
          feedback: note(1000),
        })
        .refine((s) => !s.excused || s.score === null, {
          path: ['score'],
          message: 'An excused student has no score',
        }),
    )
    .min(1)
    .max(500)
    .refine((r) => new Set(r.map((x) => x.studentId)).size === r.length, {
      message: 'A student appears twice',
    }),
});

export interface ScoredComponent {
  weight: number;
  maxScore: number;
  score: number | null;
  excused: boolean;
}

/**
 * Weighted mark in percent. Excused components are left out and the remaining
 * weights rescaled; components without a score count as zero. Null when no
 * weight remains (nothing to grade).
 */
export function weightedPercent(components: ScoredComponent[]): number | null {
  const counted = components.filter((c) => !c.excused);
  const total = counted.reduce((s, c) => s + c.weight, 0);
  if (total <= 0) return null;
  const earned = counted.reduce(
    (s, c) => s + (Math.min(c.score ?? 0, c.maxScore) / c.maxScore) * c.weight,
    0,
  );
  return Math.round((earned / total) * 10000) / 100;
}

/** The scale band a percentage falls into: the highest `minPercent` not above it. */
export function letterFor<T extends { minPercent: number }>(bands: T[], percent: number) {
  return (
    [...bands].sort((a, b) => b.minPercent - a.minPercent).find((b) => percent >= b.minPercent) ??
    null
  );
}

// ----- final grades (FR-ACAD-006) ----------------------------------------------------------

export const finalGradesSchema = z.object({
  grades: z
    .array(
      z.object({
        registrationId: z.uuid(),
        gradeLetter: z.string().trim().min(1).max(5).toUpperCase(),
      }),
    )
    .min(1)
    .max(500)
    .refine((g) => new Set(g.map((x) => x.registrationId)).size === g.length, {
      message: 'A student appears twice',
    }),
});

export const gradeReturnSchema = z.object({
  reason: z.string().trim().min(5, 'Tell the instructor what to fix').max(1000),
});

export const gradeChangeSchema = z.object({
  gradeLetter: z.string().trim().min(1).max(5).toUpperCase(),
  reason: z.string().trim().min(10, 'Explain the change (at least 10 characters)').max(1000),
});
export type GradeChangeInput = z.input<typeof gradeChangeSchema>;

export const classroomAvailabilityQuerySchema = z.object({
  sessionId: z.uuid(),
  campusId: z.uuid().optional(),
  minCapacity: z.coerce.number().int().min(1).max(5000).optional(),
  type: z.string().max(40).optional(),
});
