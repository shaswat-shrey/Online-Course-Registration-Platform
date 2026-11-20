import { z } from 'zod';

/*
 * Registration engine inputs and constants (SRS §20.2–20.3, FR-ADMIN-020..024).
 */

export const REGISTRATION_STATUSES = [
  'PENDING',
  'REGISTERED',
  'WAITLISTED',
  'OFFERED',
  'DROPPED',
  'WITHDRAWN',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
  'COMPLETED',
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];
/** Statuses that occupy a seat (count towards `enrolledCount`). */
export const SEAT_HOLDING_STATUSES = ['PENDING', 'REGISTERED', 'OFFERED'] as const;
/** Statuses that block another attempt at the same course in the session. */
export const ACTIVE_STATUSES = ['PENDING', 'REGISTERED', 'OFFERED', 'WAITLISTED'] as const;

/** Rules an administrator may bypass (FR-ADMIN-022); holds and student status cannot be overridden. */
export const OVERRIDABLE_RULES = [
  'PERIOD',
  'CAPACITY',
  'PREREQUISITE',
  'COREQUISITE',
  'RESTRICTION',
  'CREDIT_LIMIT',
  'TIME_CONFLICT',
] as const;
export type OverridableRule = (typeof OVERRIDABLE_RULES)[number];

const reason = (min: number) =>
  z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => (v ? v : null))
    .refine(
      (v) => min === 0 || (v?.length ?? 0) >= min,
      `Give a reason (at least ${min} characters)`,
    );

export const registerSchema = z.object({
  sectionId: z.uuid(),
  /** Join the waitlist if the section is full. */
  joinWaitlist: z.boolean().default(false),
});

const overrideList = z
  .array(z.enum(OVERRIDABLE_RULES))
  .max(OVERRIDABLE_RULES.length)
  .default([])
  .transform((list) => [...new Set(list)]);

export const adminRegisterSchema = z
  .object({
    studentId: z.uuid(),
    sectionId: z.uuid(),
    joinWaitlist: z.boolean().default(false),
    overrides: overrideList,
    reason: reason(0),
  })
  .refine((v) => v.overrides.length === 0 || (v.reason?.length ?? 0) >= 5, {
    path: ['reason'],
    message: 'Overrides need a reason (at least 5 characters)',
  });

export const eligibilityQuerySchema = z.object({
  sectionId: z.uuid(),
  /** Administrators preview for a student; students omit it. */
  studentId: z.uuid().optional(),
});

export const batchRegisterSchema = z.object({
  items: z
    .array(z.object({ sectionId: z.uuid(), joinWaitlist: z.boolean().default(false) }))
    .min(1)
    .max(12)
    .refine((items) => new Set(items.map((i) => i.sectionId)).size === items.length, {
      message: 'A section appears twice',
    }),
});

/** Drop, withdraw or cancel. `alsoDrop` lets corequisite pairs be dropped together (FR-REG-019). */
export const dropSchema = z
  .object({
    reason: reason(0),
    alsoDrop: z.array(z.uuid()).max(10).default([]),
    overrides: z.array(z.enum(['PERIOD', 'COREQUISITE'])).default([]),
  })
  .refine((v) => v.overrides.length === 0 || (v.reason?.length ?? 0) >= 5, {
    path: ['reason'],
    message: 'Overrides need a reason (at least 5 characters)',
  });
export const withdrawSchema = z
  .object({
    reason: reason(0),
    overrides: z.array(z.enum(['PERIOD'])).default([]),
  })
  .refine((v) => v.overrides.length === 0 || (v.reason?.length ?? 0) >= 5, {
    path: ['reason'],
    message: 'Overrides need a reason (at least 5 characters)',
  });

export const decisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    note: reason(0),
  })
  .refine((v) => v.decision === 'APPROVE' || (v.note?.length ?? 0) >= 5, {
    path: ['note'],
    message: 'Give a reason for rejecting (at least 5 characters)',
  });
export const bulkDecisionSchema = z
  .object({
    ids: z.array(z.uuid()).min(1).max(200),
    decision: z.enum(['APPROVE', 'REJECT']),
    note: reason(0),
  })
  .refine((v) => v.decision === 'APPROVE' || (v.note?.length ?? 0) >= 5, {
    path: ['note'],
    message: 'Give a reason for rejecting (at least 5 characters)',
  });

export const coursePlanSchema = z.object({
  sessionId: z.uuid(),
  name: z.string().trim().min(1).max(100),
});
export const coursePlanItemsSchema = z.object({
  items: z
    .array(
      z.object({
        courseId: z.uuid(),
        sectionId: z
          .uuid()
          .nullish()
          .transform((v) => v ?? null),
      }),
    )
    .max(20)
    .refine((items) => new Set(items.map((i) => i.courseId)).size === items.length, {
      message: 'A course appears twice',
    }),
});

export const markNotificationsSchema = z.object({
  ids: z.array(z.uuid()).max(200).optional(),
  all: z.boolean().optional(),
});
