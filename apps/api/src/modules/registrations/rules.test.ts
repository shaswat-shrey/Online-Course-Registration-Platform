import { describe, expect, it } from 'vitest';
import { effectiveOpensAt, evaluate, type RuleContext } from './rules.js';

const base = (): RuleContext => ({
  now: new Date('2026-12-05T10:00:00Z'),
  student: {
    id: 's',
    userId: 'u',
    status: 'ACTIVE',
    accountStatus: 'ACTIVE',
    programId: 'p',
    departmentId: 'd',
    specializationId: null,
    yearOfStudy: 3,
    cohort: null,
  },
  holds: [],
  section: {
    id: 'x',
    sectionCode: 'A',
    status: 'PUBLISHED',
    registrationOpen: true,
    capacity: 10,
    enrolledCount: 10,
    waitlistCapacity: 5,
    waitlistCount: 0,
    meetings: [],
    restrictions: [],
  },
  course: {
    id: 'c',
    code: 'CS301',
    status: 'ACTIVE',
    credits: 4,
    departmentId: 'd',
    isRepeatable: false,
    prerequisites: [[{ courseId: 'pre', code: 'CS201', minGradeLetter: 'B' }]],
    corequisites: [],
    restrictions: [],
  },
  session: {
    id: 'ses',
    status: 'PLANNED',
    policy: {
      maxCredits: 24,
      maxCreditsWithOverride: null,
      approvalMode: 'NONE',
      waitlistEnabled: true,
      waitlistMaxPerSection: 2,
      countWaitlistInCredits: false,
      allowInProgressPrereqs: false,
    },
    period: {
      opensAt: new Date('2026-12-01T03:30:00Z'),
      closesAt: new Date('2026-12-04T18:29:00Z'),
      lateClosesAt: new Date('2026-12-10T18:29:00Z'),
      windows: [
        {
          name: 'Third years',
          opensAt: new Date('2026-11-28T03:30:00Z'),
          programId: null,
          yearOfStudy: 3,
          cohort: null,
        },
      ],
    },
    gradeOrder: ['O', 'A+', 'A', 'B+', 'B', 'C', 'P', 'F'],
  },
  passed: new Map([['pre', { gradeLetter: 'A' }]]),
  inProgress: new Set(),
  current: [],
});

describe('rule pipeline', () => {
  it('requires approval in the late window (BR-019) and caps the waitlist by policy', () => {
    const ev = evaluate(base());
    expect(ev.blocking).toBeNull();
    expect(ev.needsApproval).toBe(true);
    expect(ev.full).toBe(true);
    expect(ev.waitlistAvailable).toBe(true);
    const capped = base();
    capped.section.waitlistCount = 2;
    expect(evaluate(capped).waitlistAvailable).toBe(false);
  });

  it('opens early for students matching a priority window', () => {
    expect(effectiveOpensAt(base())!.toISOString()).toBe('2026-11-28T03:30:00.000Z');
    const other = base();
    other.student.yearOfStudy = 1;
    expect(effectiveOpensAt(other)!.toISOString()).toBe('2026-12-01T03:30:00.000Z');
  });

  it('compares grades by scale order and honours overrides', () => {
    const low = base();
    low.passed = new Map([['pre', { gradeLetter: 'C' }]]);
    expect(evaluate(low).blocking?.code).toBe('PREREQUISITE_NOT_MET');
    expect(evaluate(low, new Set(['PREREQUISITE'])).blocking).toBeNull();
  });
});
