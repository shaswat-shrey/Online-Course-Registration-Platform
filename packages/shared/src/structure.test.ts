import { describe, expect, it } from 'vitest';
import {
  departmentCreateSchema,
  gradingScaleSchema,
  programCreateSchema,
  registrationPeriodSchema,
  requirementGroupCreateSchema,
  sessionPolicySchema,
  universityUpdateSchema,
} from './structure.js';

const ID = '0196f000-0000-7000-8000-000000000001';

describe('structure schemas', () => {
  it('normalizes codes and turns empty optional text into null', () => {
    const v = departmentCreateSchema.parse({
      code: ' cse-1 ',
      name: 'Computer Science',
      schoolId: ID,
      contactEmail: '',
      campusId: '',
    });
    expect(v).toMatchObject({
      code: 'CSE-1',
      contactEmail: null,
      campusId: null,
      description: null,
    });
    expect(
      departmentCreateSchema.safeParse({ code: 'C S', name: 'X Y', schoolId: ID }).success,
    ).toBe(false);
  });

  it('validates time zones', () => {
    expect(universityUpdateSchema.safeParse({ timezone: 'Asia/Kolkata' }).success).toBe(true);
    expect(universityUpdateSchema.safeParse({ timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(universityUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('checks program credit arithmetic and decimals', () => {
    const base = {
      code: 'BTECH-CS',
      name: 'B.Tech CS',
      degreeId: ID,
      departmentId: ID,
      durationYears: 4,
      sessionCount: 8,
    };
    expect(
      programCreateSchema.safeParse({
        ...base,
        totalCredits: 160,
        minCoreCredits: 100,
        minElectiveCredits: 40,
      }).success,
    ).toBe(true);
    expect(
      programCreateSchema.safeParse({
        ...base,
        totalCredits: 160,
        minCoreCredits: 150,
        minElectiveCredits: 40,
      }).success,
    ).toBe(false);
    expect(programCreateSchema.safeParse({ ...base, totalCredits: 160.25 }).success).toBe(false);
  });

  it('ties category to the requirement kind', () => {
    expect(
      requirementGroupCreateSchema.safeParse({
        name: 'Labs',
        kind: 'CREDITS_FROM_CATEGORY',
        minCredits: 6,
      }).success,
    ).toBe(false);
    expect(
      requirementGroupCreateSchema.safeParse({
        name: 'Labs',
        kind: 'CREDITS_FROM_CATEGORY',
        minCredits: 6,
        category: 'LABORATORY',
      }).success,
    ).toBe(true);
    expect(
      requirementGroupCreateSchema.safeParse({ name: 'Open', kind: 'CREDITS_ANY' }).success,
    ).toBe(false);
    expect(requirementGroupCreateSchema.safeParse({ name: 'Core', kind: 'ALL_OF' }).success).toBe(
      true,
    );
  });

  it('orders registration period instants', () => {
    const ok = {
      opensAt: '2026-12-01T04:30:00Z',
      closesAt: '2026-12-15T18:29:00Z',
      addDropDeadline: '2027-01-15T18:29:00Z',
      withdrawalDeadline: '2027-03-01T18:29:00Z',
    };
    expect(registrationPeriodSchema.safeParse(ok).success).toBe(true);
    const bad = registrationPeriodSchema.safeParse({
      ...ok,
      withdrawalDeadline: '2027-01-01T00:00:00Z',
    });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues[0]!.path).toEqual(['withdrawalDeadline']);
  });

  it('validates credit policy limits', () => {
    const base = {
      minCredits: 12,
      maxCredits: 24,
      maxCreditsWithOverride: 28,
      approvalMode: 'NONE',
      waitlistEnabled: true,
      promotionMode: 'AUTO_ENROLL',
      offerWindowHours: 24,
      countWaitlistInCredits: false,
      allowInProgressPrereqs: true,
      withdrawalRequiresApproval: false,
    };
    expect(sessionPolicySchema.safeParse(base).success).toBe(true);
    expect(sessionPolicySchema.safeParse({ ...base, minCredits: 30 }).success).toBe(false);
    expect(sessionPolicySchema.safeParse({ ...base, maxCreditsWithOverride: 20 }).success).toBe(
      false,
    );
  });

  it('requires a complete, consistent grading scale', () => {
    const entries = [
      { letter: 'A', minPercent: 80, gradePoints: 4, isPassing: true },
      { letter: 'F', minPercent: 0, gradePoints: 0, isPassing: false },
    ];
    expect(gradingScaleSchema.safeParse({ name: 'Scale', entries }).success).toBe(true);
    expect(gradingScaleSchema.safeParse({ name: 'Scale', entries: [entries[0]] }).success).toBe(
      false,
    );
    expect(
      gradingScaleSchema.safeParse({
        name: 'Scale',
        entries: [entries[0], { ...entries[1], gradePoints: null }],
      }).success,
    ).toBe(false);
    expect(
      gradingScaleSchema.safeParse({
        name: 'Scale',
        entries: [entries[0], { ...entries[1], letter: 'A' }],
      }).success,
    ).toBe(false);
  });
});
