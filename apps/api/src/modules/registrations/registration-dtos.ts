import { z } from 'zod';

const meeting = z.object({ dayOfWeek: z.number(), startMinute: z.number(), endMinute: z.number() });

export const registrationDto = z
  .object({
    id: z.uuid(),
    status: z.string(),
    credits: z.number(),
    student: z.object({
      id: z.uuid(),
      studentNumber: z.string(),
      name: z.string(),
      email: z.string(),
      yearOfStudy: z.number(),
      program: z.object({ code: z.string(), name: z.string() }),
    }),
    course: z.object({ id: z.uuid(), code: z.string(), title: z.string(), credits: z.number() }),
    section: z.object({
      id: z.uuid(),
      sectionCode: z.string(),
      status: z.string(),
      meetings: z.array(meeting),
      instructor: z.string().nullable(),
    }),
    session: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
    waitlistedAt: z.string().nullable(),
    offerExpiresAt: z.string().nullable(),
    registeredAt: z.string().nullable(),
    endedAt: z.string().nullable(),
    overrides: z.array(z.string()),
    overrideReason: z.string().nullable(),
    pendingRequest: z
      .object({
        id: z.uuid(),
        type: z.string(),
        reason: z.string().nullable(),
        createdAt: z.string(),
      })
      .nullable(),
    waitlistPosition: z.number().nullable().optional(),
    replay: z.boolean().optional(),
    createdAt: z.string(),
  })
  .meta({ id: 'Registration' });

export const registrationDetailDto = registrationDto
  .extend({
    history: z.array(
      z.object({
        id: z.uuid(),
        from: z.string().nullable(),
        to: z.string(),
        action: z.string(),
        actor: z.string(),
        reason: z.string().nullable(),
        details: z.unknown(),
        at: z.string(),
      }),
    ),
  })
  .meta({ id: 'RegistrationDetail' });

export const eligibilityDto = z
  .object({
    sectionId: z.uuid(),
    studentId: z.uuid(),
    eligible: z.boolean(),
    outcome: z.enum(['REGISTER', 'PENDING', 'WAITLIST', 'FULL', 'BLOCKED']),
    rules: z.array(
      z.object({
        code: z.string(),
        passed: z.boolean(),
        message: z.string(),
        details: z.unknown(),
        overridable: z.string().nullable(),
      }),
    ),
  })
  .meta({ id: 'Eligibility' });

const itemError = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export const batchResultDto = z
  .object({
    results: z.array(
      z.object({
        sectionId: z.uuid(),
        ok: z.boolean(),
        registration: registrationDto.optional(),
        error: itemError.optional(),
      }),
    ),
    succeeded: z.number(),
    failed: z.number(),
  })
  .meta({ id: 'BatchRegistrationResult' });

export const decisionResultDto = z
  .object({
    results: z.array(
      z.object({
        id: z.uuid(),
        ok: z.boolean(),
        status: z.string().optional(),
        error: itemError.optional(),
      }),
    ),
    succeeded: z.number(),
    failed: z.number(),
  })
  .meta({ id: 'BulkDecisionResult' });

export const registrationRequestDto = z
  .object({
    id: z.uuid(),
    type: z.string(),
    status: z.string(),
    reason: z.string().nullable(),
    decisionNote: z.string().nullable(),
    createdAt: z.string(),
    registration: registrationDto,
  })
  .meta({ id: 'RegistrationRequest' });

export const sectionRegistrationsDto = z
  .object({
    capacity: z.number(),
    enrolledCount: z.number(),
    waitlistCount: z.number(),
    seats: z.array(registrationDto),
    waitlist: z.array(registrationDto),
    canManage: z.boolean(),
    canManageWaitlist: z.boolean(),
    canApprove: z.boolean(),
  })
  .meta({ id: 'SectionRegistrations' });
