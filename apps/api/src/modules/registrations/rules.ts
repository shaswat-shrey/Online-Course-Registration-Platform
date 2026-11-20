import { ErrorCode, meetingsOverlap, type OverridableRule } from '@ucrams/shared';

/*
 * Registration rule pipeline (SRS FR-REG-001..013, ARCHITECTURE.md §8).
 * Every rule is a pure function of a loaded context, so the same list powers
 * the eligibility preview, submission (inside the locks), admin overrides,
 * batch registration and waitlist promotion.
 */

export interface MeetingSlot {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

export interface RuleContext {
  now: Date;
  student: {
    id: string;
    userId: string;
    status: string;
    accountStatus: string;
    programId: string;
    departmentId: string;
    specializationId: string | null;
    yearOfStudy: number;
    cohort: string | null;
  };
  holds: Array<{ type: string; reason: string | null }>;
  section: {
    id: string;
    sectionCode: string;
    status: string;
    registrationOpen: boolean;
    capacity: number;
    enrolledCount: number;
    waitlistCapacity: number;
    waitlistCount: number;
    meetings: MeetingSlot[];
    restrictions: Restriction[];
  };
  course: {
    id: string;
    code: string;
    status: string;
    credits: number;
    departmentId: string;
    isRepeatable: boolean;
    prerequisites: Array<Array<{ courseId: string; code: string; minGradeLetter: string | null }>>;
    corequisites: Array<{ id: string; code: string }>;
    restrictions: Restriction[];
  };
  session: {
    id: string;
    status: string;
    policy: {
      maxCredits: number;
      maxCreditsWithOverride: number | null;
      approvalMode: string;
      waitlistEnabled: boolean;
      waitlistMaxPerSection: number | null;
      countWaitlistInCredits: boolean;
      allowInProgressPrereqs: boolean;
    } | null;
    period: {
      opensAt: Date;
      closesAt: Date;
      lateClosesAt: Date | null;
      windows: Array<{
        name: string;
        opensAt: Date;
        programId: string | null;
        yearOfStudy: number | null;
        cohort: string | null;
      }>;
    } | null;
    /** Grade letters best-first (position order) of the session's grading scale. */
    gradeOrder: string[];
  };
  /** Best passed record per course (letter may be null for transfer/exemption). */
  passed: Map<string, { gradeLetter: string | null }>;
  /** Courses currently being taken in another (not yet completed) session. */
  inProgress: Set<string>;
  /** Active registrations of the student in this session (other sections). */
  current: Array<{
    id: string;
    courseId: string;
    courseCode: string;
    sectionId: string;
    sectionCode: string;
    status: string;
    credits: number;
    meetings: MeetingSlot[];
  }>;
}

export interface Restriction {
  mode: 'INCLUDE' | 'EXCLUDE';
  targetType: 'DEPARTMENT' | 'PROGRAM' | 'SPECIALIZATION' | 'YEAR_OF_STUDY';
  targetId: string | null;
  targetValue: number | null;
  label?: string;
}

export interface RuleResult {
  code: string;
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
  /** Override that bypasses this rule, if any. */
  override?: OverridableRule;
}

export interface RuleOptions {
  /** Courses submitted together (corequisites in the same batch count, FR-REG-009). */
  batchCourseIds?: Set<string>;
}

const SEAT_HOLDING = new Set(['PENDING', 'REGISTERED', 'OFFERED']);

const pass = (code: string, message: string, extra: Partial<RuleResult> = {}): RuleResult => ({
  code,
  ok: true,
  message,
  ...extra,
});
const fail = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
  override?: OverridableRule,
): RuleResult => ({
  code,
  ok: false,
  message,
  ...(details ? { details } : {}),
  ...(override ? { override } : {}),
});

/** When the registration window opens for this student (priority windows can open it earlier). */
export function effectiveOpensAt(ctx: RuleContext): Date | null {
  const p = ctx.session.period;
  if (!p) return null;
  const s = ctx.student;
  const matching = p.windows.filter(
    (w) =>
      (w.programId === null || w.programId === s.programId) &&
      (w.yearOfStudy === null || w.yearOfStudy === s.yearOfStudy) &&
      (w.cohort === null || w.cohort === s.cohort),
  );
  return new Date(Math.min(p.opensAt.getTime(), ...matching.map((w) => w.opensAt.getTime())));
}

/** True while adds are in the late window (registrations need approval, BR-019). */
export function isLate(ctx: RuleContext): boolean {
  const p = ctx.session.period;
  return !!p && ctx.now >= p.closesAt && !!p.lateClosesAt && ctx.now < p.lateClosesAt;
}

function meetsGrade(ctx: RuleContext, actual: string | null, minimum: string | null): boolean {
  if (!minimum || actual === null) return true;
  const order = ctx.session.gradeOrder;
  const a = order.indexOf(actual);
  const m = order.indexOf(minimum);
  // Letters outside the session's scale cannot be compared; a pass is accepted.
  if (a === -1 || m === -1) return true;
  return a <= m;
}

function matches(ctx: RuleContext, r: Restriction): boolean {
  const s = ctx.student;
  switch (r.targetType) {
    case 'DEPARTMENT':
      return r.targetId === s.departmentId;
    case 'PROGRAM':
      return r.targetId === s.programId;
    case 'SPECIALIZATION':
      return r.targetId === s.specializationId;
    case 'YEAR_OF_STUDY':
      return r.targetValue === s.yearOfStudy;
  }
}

/** Effective waitlist size: the section's, capped by the session policy. */
export function waitlistLimit(ctx: RuleContext): number {
  const policy = ctx.session.policy;
  if (!policy?.waitlistEnabled) return 0;
  return Math.min(
    ctx.section.waitlistCapacity,
    policy.waitlistMaxPerSection ?? Number.POSITIVE_INFINITY,
  );
}

type Rule = (ctx: RuleContext, opts: RuleOptions) => RuleResult;

export const RULES: Rule[] = [
  // FR-REG-002
  (ctx) =>
    ctx.student.status === 'ACTIVE' && ctx.student.accountStatus === 'ACTIVE'
      ? pass(ErrorCode.STUDENT_NOT_ACTIVE, 'Student is active')
      : fail(ErrorCode.STUDENT_NOT_ACTIVE, 'Only active students can register', {
          studentStatus: ctx.student.status,
          accountStatus: ctx.student.accountStatus,
        }),
  // FR-REG-003
  (ctx) =>
    ctx.holds.length === 0
      ? pass(ErrorCode.REGISTRATION_HOLD, 'No registration holds')
      : fail(ErrorCode.REGISTRATION_HOLD, 'A registration hold blocks registration', {
          holds: ctx.holds.map((h) => h.type),
        }),
  // FR-REG-004
  (ctx) => {
    const p = ctx.session.period;
    if (!p)
      return fail(
        ErrorCode.REGISTRATION_PERIOD_CLOSED,
        'Registration is not set up for this session',
        undefined,
        'PERIOD',
      );
    const opensAt = effectiveOpensAt(ctx)!;
    if (ctx.now < opensAt)
      return fail(
        ErrorCode.REGISTRATION_NOT_YET_OPEN,
        'Registration has not opened yet',
        { opensAt: opensAt.toISOString() },
        'PERIOD',
      );
    if (ctx.now < p.closesAt)
      return pass(ErrorCode.REGISTRATION_PERIOD_CLOSED, 'Registration is open');
    if (isLate(ctx))
      return pass(ErrorCode.REGISTRATION_PERIOD_CLOSED, 'Late registration (needs approval)', {
        details: { late: true },
      });
    return fail(
      ErrorCode.REGISTRATION_PERIOD_CLOSED,
      'Registration for this session has closed',
      {
        closedAt: (p.lateClosesAt ?? p.closesAt).toISOString(),
      },
      'PERIOD',
    );
  },
  // FR-REG-005
  (ctx) => {
    const ok =
      ctx.section.status === 'PUBLISHED' &&
      ctx.section.registrationOpen &&
      ctx.course.status === 'ACTIVE' &&
      (ctx.session.status === 'PLANNED' || ctx.session.status === 'ACTIVE');
    return ok
      ? pass(ErrorCode.SECTION_NOT_AVAILABLE, 'Section is open for registration')
      : fail(ErrorCode.SECTION_NOT_AVAILABLE, 'This section is not open for registration', {
          sectionStatus: ctx.section.status,
          registrationOpen: ctx.section.registrationOpen,
        });
  },
  // FR-REG-006
  (ctx) => {
    const dup = ctx.current.find((r) => r.courseId === ctx.course.id);
    return dup
      ? fail(
          ErrorCode.DUPLICATE_REGISTRATION,
          `Already ${dup.status.toLowerCase()} in ${ctx.course.code} ${dup.sectionCode}`,
          {
            registrationId: dup.id,
            sectionCode: dup.sectionCode,
            status: dup.status,
          },
        )
      : pass(ErrorCode.DUPLICATE_REGISTRATION, 'Not already registered for this course');
  },
  // FR-REG-007
  (ctx) =>
    ctx.passed.has(ctx.course.id) && !ctx.course.isRepeatable
      ? fail(ErrorCode.COURSE_ALREADY_COMPLETED, `${ctx.course.code} has already been passed`)
      : pass(ErrorCode.COURSE_ALREADY_COMPLETED, 'Course not completed before'),
  // FR-REG-008
  (ctx) => {
    const allowInProgress = ctx.session.policy?.allowInProgressPrereqs ?? false;
    const unmet = ctx.course.prerequisites.filter(
      (group) =>
        !group.some((item) => {
          const record = ctx.passed.get(item.courseId);
          if (record && meetsGrade(ctx, record.gradeLetter, item.minGradeLetter)) return true;
          return allowInProgress && ctx.inProgress.has(item.courseId);
        }),
    );
    if (!unmet.length) return pass(ErrorCode.PREREQUISITE_NOT_MET, 'Prerequisites met');
    const missing = unmet.map((g) =>
      g
        .map((i) => (i.minGradeLetter ? `${i.code} (min ${i.minGradeLetter})` : i.code))
        .join(' or '),
    );
    return fail(
      ErrorCode.PREREQUISITE_NOT_MET,
      `Missing prerequisites: ${missing.join('; ')}`,
      { missing },
      'PREREQUISITE',
    );
  },
  // FR-REG-009
  (ctx, opts) => {
    const missing = ctx.course.corequisites.filter(
      (c) =>
        !ctx.passed.has(c.id) &&
        !ctx.current.some((r) => r.courseId === c.id && r.status !== 'WAITLISTED') &&
        !opts.batchCourseIds?.has(c.id),
    );
    return missing.length
      ? fail(
          ErrorCode.COREQUISITE_NOT_MET,
          `Take with: ${missing.map((m) => m.code).join(', ')}`,
          {
            missing: missing.map((m) => m.code),
          },
          'COREQUISITE',
        )
      : pass(ErrorCode.COREQUISITE_NOT_MET, 'Corequisites met');
  },
  // FR-REG-010
  (ctx) => {
    const rules = [...ctx.course.restrictions, ...ctx.section.restrictions];
    const excluded = rules.find((r) => r.mode === 'EXCLUDE' && matches(ctx, r));
    if (excluded)
      return fail(
        ErrorCode.RESTRICTION_NOT_MET,
        `Not open to ${excluded.label ?? excluded.targetType.toLowerCase()}`,
        {
          restriction: excluded,
        },
        'RESTRICTION',
      );
    const byType = new Map<string, Restriction[]>();
    for (const r of rules.filter((x) => x.mode === 'INCLUDE'))
      byType.set(r.targetType, [...(byType.get(r.targetType) ?? []), r]);
    for (const [type, list] of byType) {
      if (!list.some((r) => matches(ctx, r)))
        return fail(
          ErrorCode.RESTRICTION_NOT_MET,
          `Only open to ${list.map((r) => r.label ?? type.toLowerCase()).join(' or ')}`,
          {
            restriction: {
              mode: 'INCLUDE',
              targetType: type,
              allowed: list.map((r) => r.label ?? r.targetId ?? r.targetValue),
            },
          },
          'RESTRICTION',
        );
    }
    return pass(ErrorCode.RESTRICTION_NOT_MET, 'Eligible under course restrictions');
  },
  // FR-REG-011, BR-017
  (ctx) => {
    const policy = ctx.session.policy;
    if (!policy) return pass(ErrorCode.CREDIT_LIMIT_EXCEEDED, 'No credit limit configured');
    const current = ctx.current
      .filter(
        (r) =>
          SEAT_HOLDING.has(r.status) ||
          (policy.countWaitlistInCredits && r.status === 'WAITLISTED'),
      )
      .reduce((sum, r) => sum + r.credits, 0);
    const attempted = current + ctx.course.credits;
    return attempted <= policy.maxCredits
      ? pass(ErrorCode.CREDIT_LIMIT_EXCEEDED, `${attempted} of ${policy.maxCredits} credits`)
      : fail(
          ErrorCode.CREDIT_LIMIT_EXCEEDED,
          `This would take you to ${attempted} credits; the limit is ${policy.maxCredits}`,
          {
            current,
            attempted,
            max: policy.maxCredits,
            maxWithOverride: policy.maxCreditsWithOverride,
          },
          'CREDIT_LIMIT',
        );
  },
  // FR-REG-012, BR-018
  (ctx) => {
    const conflicts = ctx.current
      .filter((r) => SEAT_HOLDING.has(r.status))
      .filter((r) =>
        r.meetings.some((m) => ctx.section.meetings.some((mine) => meetingsOverlap(m, mine))),
      )
      .map((r) => ({ registrationId: r.id, courseCode: r.courseCode, sectionCode: r.sectionCode }));
    return conflicts.length
      ? fail(
          ErrorCode.TIMETABLE_CONFLICT,
          `Clashes with ${conflicts.map((c) => `${c.courseCode} ${c.sectionCode}`).join(', ')}`,
          { conflicts },
          'TIME_CONFLICT',
        )
      : pass(ErrorCode.TIMETABLE_CONFLICT, 'No timetable clash');
  },
  // FR-REG-013
  (ctx) => {
    const free = ctx.section.capacity - ctx.section.enrolledCount;
    if (free > 0) return pass(ErrorCode.SECTION_FULL, `${free} seat(s) available`);
    const limit = waitlistLimit(ctx);
    return fail(
      ErrorCode.SECTION_FULL,
      'The section is full',
      {
        waitlistAvailable: ctx.section.waitlistCount < limit,
        waitlistCount: ctx.section.waitlistCount,
        waitlistCapacity: limit,
      },
      'CAPACITY',
    );
  },
];

export interface Evaluation {
  results: RuleResult[];
  /** First failing rule not bypassed by an override (SECTION_FULL handled by the caller). */
  blocking: RuleResult | null;
  full: boolean;
  waitlistAvailable: boolean;
  /** Registration would be created as PENDING (approval or late window). */
  needsApproval: boolean;
}

export function evaluate(
  ctx: RuleContext,
  overrides: Set<OverridableRule> = new Set(),
  opts: RuleOptions = {},
): Evaluation {
  const results = RULES.map((rule) => rule(ctx, opts));
  const failing = results.filter((r) => !r.ok && !(r.override && overrides.has(r.override)));
  const seat = results.find((r) => r.code === ErrorCode.SECTION_FULL)!;
  const full = !seat.ok;
  const blocking = failing.find((r) => r.code !== ErrorCode.SECTION_FULL) ?? null;
  const mode = ctx.session.policy?.approvalMode ?? 'NONE';
  const needsApproval =
    isLate(ctx) ||
    mode === 'ALL' ||
    (mode === 'CROSS_DEPARTMENT' && ctx.course.departmentId !== ctx.student.departmentId);
  return {
    results,
    blocking,
    full,
    waitlistAvailable: full && Boolean(seat.details?.waitlistAvailable),
    needsApproval,
  };
}
