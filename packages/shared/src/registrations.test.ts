import { describe, expect, it } from 'vitest';
import {
  adminRegisterSchema,
  batchRegisterSchema,
  decisionSchema,
  dropSchema,
} from './registrations.js';

const id = (n: number) => `0196f000-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('registration schemas', () => {
  it('requires a reason for overrides and de-duplicates them', () => {
    const base = { studentId: id(1), sectionId: id(2) };
    expect(adminRegisterSchema.safeParse({ ...base, overrides: ['CAPACITY'] }).success).toBe(false);
    const ok = adminRegisterSchema.parse({
      ...base,
      overrides: ['CAPACITY', 'CAPACITY'],
      reason: 'Approved by HOD',
    });
    expect(ok.overrides).toEqual(['CAPACITY']);
    expect(adminRegisterSchema.parse(base)).toMatchObject({
      overrides: [],
      reason: null,
      joinWaitlist: false,
    });
  });

  it('rejects unknown override rules (holds cannot be overridden)', () => {
    expect(
      adminRegisterSchema.safeParse({
        studentId: id(1),
        sectionId: id(2),
        overrides: ['HOLD'],
        reason: 'x'.repeat(10),
      }).success,
    ).toBe(false);
    expect(dropSchema.safeParse({ overrides: ['PERIOD'] }).success).toBe(false);
  });

  it('needs a note to reject and unique sections in a batch', () => {
    expect(decisionSchema.safeParse({ decision: 'REJECT' }).success).toBe(false);
    expect(decisionSchema.safeParse({ decision: 'APPROVE' }).success).toBe(true);
    expect(
      batchRegisterSchema.safeParse({ items: [{ sectionId: id(1) }, { sectionId: id(1) }] })
        .success,
    ).toBe(false);
  });
});
