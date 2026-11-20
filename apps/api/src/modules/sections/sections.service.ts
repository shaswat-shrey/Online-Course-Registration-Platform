import type { z } from 'zod';
import {
  ErrorCode,
  type PermissionKey,
  type rollForwardSchema,
  type SectionAction,
  type sectionCreateSchema,
  type sectionInstructorsSchema,
  type sectionMeetingsSchema,
  type SectionStatus,
  type sectionUpdateSchema,
} from '@ucrams/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext } from '../../common/context/actor.js';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/exceptions/app-error.js';
import { isoDate, num, paging } from '../../common/http/list-query.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { diffChanges, recordAudit } from '../audit/audit.service.js';
import { assertInScope, covers, scopeFilter } from '../authz/authz.js';
import {
  assertRestrictionTargets,
  type RestrictionLike,
} from '../courses/course-relations.service.js';
import { restrictionDtos } from '../courses/courses.service.js';
import { seesAllSections } from '../courses/course-scope.js';
import { hasDependents } from '../structure-scope.js';
import { findConflicts, lockSessionSchedule, type Conflict } from './section-conflicts.js';

const invalid = (path: string, message: string) =>
  new BusinessRuleError(ErrorCode.VALIDATION_ERROR, message, {
    fields: [{ path: `body.${path}`, message }],
  });

const include = {
  course: {
    select: {
      id: true,
      code: true,
      title: true,
      credits: true,
      status: true,
      category: true,
      departmentId: true,
      department: { select: { id: true, code: true, name: true, schoolId: true } },
    },
  },
  session: {
    select: { id: true, code: true, name: true, status: true, startDate: true, endDate: true },
  },
  campus: { select: { id: true, code: true, name: true } },
  meetings: {
    orderBy: [
      { dayOfWeek: 'asc' },
      { startMinute: 'asc' },
    ] as Prisma.SectionMeetingOrderByWithRelationInput[],
    include: {
      classroom: {
        select: { id: true, building: true, roomNumber: true, name: true, capacity: true },
      },
    },
  },
  instructors: {
    orderBy: { role: 'asc' as const },
    include: {
      facultyMember: {
        select: {
          id: true,
          userId: true,
          designation: true,
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
  },
  _count: { select: { restrictions: true } },
} as const;
type Row = Prisma.CourseSectionGetPayload<{ include: typeof include }>;

const targetOf = (s: { course: { departmentId: string; department: { schoolId: string } } }) => ({
  departmentId: s.course.departmentId,
  schoolId: s.course.department.schoolId,
});

function toDto(s: Row, actor: ActorContext) {
  const target = targetOf(s);
  const can = (p: PermissionKey) => covers(actor.grants, p, target);
  return {
    id: s.id,
    sectionCode: s.sectionCode,
    course: {
      id: s.course.id,
      code: s.course.code,
      title: s.course.title,
      credits: num(s.course.credits)!,
      status: s.course.status,
      category: s.course.category,
      department: {
        id: s.course.department.id,
        code: s.course.department.code,
        name: s.course.department.name,
      },
    },
    session: {
      id: s.session.id,
      code: s.session.code,
      name: s.session.name,
      status: s.session.status,
      startDate: isoDate(s.session.startDate),
      endDate: isoDate(s.session.endDate),
    },
    campus: s.campus,
    capacity: s.capacity,
    enrolledCount: s.enrolledCount,
    availableSeats: Math.max(0, s.capacity - s.enrolledCount),
    waitlistCapacity: s.waitlistCapacity,
    waitlistCount: s.waitlistCount,
    status: s.status,
    registrationOpen: s.registrationOpen,
    notes: s.notes,
    publishedAt: s.publishedAt?.toISOString() ?? null,
    cancelledAt: s.cancelledAt?.toISOString() ?? null,
    cancelReason: s.cancelReason,
    scheduleOverrideReason: s.scheduleOverrideReason,
    meetings: s.meetings.map((m) => ({
      id: m.id,
      dayOfWeek: m.dayOfWeek,
      startMinute: m.startMinute,
      endMinute: m.endMinute,
      type: m.type,
      classroom: m.classroom
        ? {
            id: m.classroom.id,
            label: `${m.classroom.building} ${m.classroom.roomNumber}`,
            capacity: m.classroom.capacity,
          }
        : null,
    })),
    instructors: s.instructors.map((i) => ({
      facultyMemberId: i.facultyMember.id,
      name: `${i.facultyMember.user.firstName} ${i.facultyMember.user.lastName}`,
      email: i.facultyMember.user.email,
      designation: i.facultyMember.designation,
      role: i.role,
    })),
    hasRestrictions: s._count.restrictions > 0,
    permissions: {
      update: can('section:update'),
      publish: can('section:publish'),
      cancel: can('section:cancel'),
      assignFaculty: can('section:assign_faculty'),
      overrideConflicts: can('section:override_conflicts'),
    },
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

async function load(id: string) {
  const row = await prisma.courseSection.findUnique({ where: { id }, include });
  if (!row) throw new NotFoundError('Section');
  return row;
}

/** Non-managers see published sections and the ones they teach (FR-CRS-006). */
function visibilityWhere(actor: ActorContext): Prisma.CourseSectionWhereInput {
  if (seesAllSections(actor)) return {};
  return {
    OR: [
      { status: 'PUBLISHED', course: { status: 'ACTIVE' } },
      { instructors: { some: { facultyMember: { userId: actor.userId } } } },
    ],
  };
}

export interface SectionListQuery {
  page: number;
  limit: number;
  q?: string;
  sessionId?: string;
  courseId?: string;
  departmentId?: string;
  schoolId?: string;
  status?: SectionStatus;
  facultyMemberId?: string;
  hasSeats?: boolean;
  unassigned?: boolean;
  sort: {
    field: 'courseCode' | 'sectionCode' | 'capacity' | 'createdAt';
    direction: 'asc' | 'desc';
  }[];
}

export async function listSections(actor: ActorContext, q: SectionListQuery) {
  const and: Prisma.CourseSectionWhereInput[] = [visibilityWhere(actor)];
  if (q.q)
    and.push({
      OR: [
        { sectionCode: { contains: q.q, mode: 'insensitive' } },
        { course: { code: { contains: q.q, mode: 'insensitive' } } },
        { course: { title: { contains: q.q, mode: 'insensitive' } } },
      ],
    });
  if (q.sessionId) and.push({ sessionId: q.sessionId });
  if (q.courseId) and.push({ courseId: q.courseId });
  if (q.departmentId) and.push({ course: { departmentId: q.departmentId } });
  if (q.schoolId) and.push({ course: { department: { schoolId: q.schoolId } } });
  if (q.status) and.push({ status: q.status });
  if (q.facultyMemberId)
    and.push({ instructors: { some: { facultyMemberId: q.facultyMemberId } } });
  if (q.unassigned) and.push({ instructors: { none: { role: 'PRIMARY' } } });
  const where = { AND: and };
  const orderBy: Prisma.CourseSectionOrderByWithRelationInput[] = q.sort.map((s) =>
    s.field === 'courseCode' ? { course: { code: s.direction } } : { [s.field]: s.direction },
  );
  orderBy.push({ sectionCode: 'asc' }, { id: 'asc' });
  if (q.hasSeats) {
    // Column-to-column comparison is not expressible in Prisma's where; filter ids in SQL.
    const open = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM course_sections WHERE enrolled_count < capacity`;
    and.push({ id: { in: open.map((r) => r.id) } });
  }
  const [total, rows] = await Promise.all([
    prisma.courseSection.count({ where }),
    prisma.courseSection.findMany({ where, include, orderBy, ...paging(q) }),
  ]);
  return { total, items: rows.map((r) => toDto(r, actor)) };
}

export async function getSection(actor: ActorContext, id: string) {
  const row = await prisma.courseSection.findFirst({
    where: { AND: [{ id }, visibilityWhere(actor)] },
    include,
  });
  if (!row) throw new NotFoundError('Section');
  const restrictions = await prisma.courseRestriction.findMany({ where: { sectionId: id } });
  return { ...toDto(row, actor), restrictions: await restrictionDtos(restrictions) };
}

const EDITABLE: SectionStatus[] = ['DRAFT', 'PUBLISHED', 'CLOSED'];

function assertEditable(s: { status: SectionStatus }) {
  if (!EDITABLE.includes(s.status))
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      `A ${s.status.toLowerCase()} section can no longer be changed`,
    );
}

async function assertSchedulableSession(sessionId: string, path = 'sessionId') {
  const session = await prisma.academicSession.findUnique({ where: { id: sessionId } });
  if (!session) throw invalid(path, 'Unknown academic session');
  if (session.status !== 'PLANNED' && session.status !== 'ACTIVE')
    throw invalid(path, 'Sections can only be scheduled in planned or active sessions');
  return session;
}

async function assertCampus(campusId: string | null | undefined) {
  if (!campusId) return;
  const c = await prisma.campus.findUnique({ where: { id: campusId } });
  if (!c || c.status !== 'ACTIVE') throw invalid('campusId', 'Choose an active campus');
}

async function assertCodeFree(
  courseId: string,
  sessionId: string,
  sectionCode: string,
  exceptId?: string,
) {
  const clash = await prisma.courseSection.findFirst({
    where: { courseId, sessionId, sectionCode, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (clash)
    throw new ConflictError(
      ErrorCode.UNIQUE_VIOLATION,
      'This course already has a section with this code in the session',
      {
        fields: [{ path: 'body.sectionCode', message: 'Already used for this course and session' }],
      },
    );
}

export async function createSection(
  actor: ActorContext,
  input: z.output<typeof sectionCreateSchema>,
) {
  const course = await prisma.course.findUnique({
    where: { id: input.courseId },
    include: { department: true },
  });
  if (!course) throw invalid('courseId', 'Unknown course');
  assertInScope(actor, 'section:create', {
    departmentId: course.departmentId,
    schoolId: course.department.schoolId,
  });
  if (course.status !== 'ACTIVE' && course.status !== 'DRAFT')
    throw invalid('courseId', 'Sections can only be added to draft or active courses');
  await assertSchedulableSession(input.sessionId);
  await assertCampus(input.campusId);
  await assertCodeFree(input.courseId, input.sessionId, input.sectionCode);
  const id = await prisma.$transaction(async (tx) => {
    const s = await tx.courseSection.create({ data: input });
    await recordAudit(
      actor,
      {
        action: 'section.created',
        entityType: 'CourseSection',
        entityId: s.id,
        changes: input as never,
      },
      tx,
    );
    return s.id;
  });
  return toDto(await load(id), actor);
}

export async function updateSection(
  actor: ActorContext,
  id: string,
  input: z.output<typeof sectionUpdateSchema>,
) {
  const before = await load(id);
  assertInScope(actor, 'section:update', targetOf(before));
  assertEditable(before);
  if (input.sectionCode && input.sectionCode !== before.sectionCode)
    await assertCodeFree(before.courseId, before.sessionId, input.sectionCode, id);
  if (input.campusId !== undefined && input.campusId !== before.campusId)
    await assertCampus(input.campusId);
  // Lock the row so a concurrent registration cannot slip under the new capacity (FR-CRS-009, BR-004).
  await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ enrolled_count: number }>>`
      SELECT enrolled_count FROM course_sections WHERE id = ${id}::uuid FOR UPDATE`;
    if (input.capacity !== undefined && input.capacity < locked!.enrolled_count)
      throw new BusinessRuleError(
        ErrorCode.CAPACITY_BELOW_ENROLLMENT,
        `Capacity cannot be lower than the ${locked!.enrolled_count} students already enrolled`,
        {
          enrolled: locked!.enrolled_count,
          fields: [{ path: 'body.capacity', message: `At least ${locked!.enrolled_count}` }],
        },
      );
    if (input.waitlistCapacity !== undefined && input.waitlistCapacity < before.waitlistCount)
      throw invalid(
        'waitlistCapacity',
        `At least ${before.waitlistCount} (students already waitlisted)`,
      );
    const after = await tx.courseSection.update({ where: { id }, data: input });
    const {
      course: _c,
      session: _s,
      campus: _p,
      meetings: _m,
      instructors: _i,
      _count,
      ...plain
    } = before;
    void [_c, _s, _p, _m, _i, _count];
    await recordAudit(
      actor,
      {
        action: 'section.updated',
        entityType: 'CourseSection',
        entityId: id,
        changes: diffChanges(plain, after) as never,
      },
      tx,
    );
  });
  // Raising capacity promotes waitlisted students once registrations exist (Phase 6).
  return toDto(await load(id), actor);
}

export async function deleteSection(actor: ActorContext, id: string) {
  const s = await load(id);
  assertInScope(actor, 'section:create', targetOf(s));
  if (s.status !== 'DRAFT')
    throw hasDependents('Only draft sections can be deleted; cancel it instead', {});
  await prisma.$transaction(async (tx) => {
    await tx.courseSection.delete({ where: { id } });
    await recordAudit(
      actor,
      {
        action: 'section.deleted',
        entityType: 'CourseSection',
        entityId: id,
        changes: { course: s.course.code, sectionCode: s.sectionCode, session: s.session.code },
      },
      tx,
    );
  });
}

/** Blocks on conflicts unless overridden with a reason; classroom overrides need extra permission. */
function resolveConflicts(
  actor: ActorContext,
  target: { departmentId: string; schoolId: string },
  conflicts: Conflict[],
  override: { reason: string } | null,
) {
  if (!conflicts.length) return;
  const rooms = conflicts.some((c) => c.kind === 'CLASSROOM');
  if (!override) {
    throw new ConflictError(
      rooms ? ErrorCode.CLASSROOM_CONFLICT : ErrorCode.INSTRUCTOR_CONFLICT,
      rooms
        ? 'A classroom is already booked at this time'
        : 'An instructor is already teaching at this time',
      {
        conflicts,
        canOverride: !rooms || covers(actor.grants, 'section:override_conflicts', target),
      },
    );
  }
  if (rooms && !covers(actor.grants, 'section:override_conflicts', target))
    throw new ForbiddenError('You cannot override classroom conflicts');
}

/** All current classroom and instructor clashes of a section (rooms and teachers as saved). */
async function currentConflicts(tx: Prisma.TransactionClient, sectionId: string) {
  const s = await tx.courseSection.findUniqueOrThrow({
    where: { id: sectionId },
    select: {
      sessionId: true,
      meetings: {
        select: { dayOfWeek: true, startMinute: true, endMinute: true, classroomId: true },
      },
      instructors: { select: { facultyMemberId: true } },
    },
  });
  return findConflicts(tx, {
    sessionId: s.sessionId,
    sectionId,
    meetings: s.meetings,
    instructorIds: s.instructors.map((i) => i.facultyMemberId),
  });
}

/**
 * Remembers why a schedule was saved despite conflicts, so publishing knows the
 * clash was acknowledged; cleared once the schedule is conflict-free.
 */
async function recordOverrideState(
  tx: Prisma.TransactionClient,
  sectionId: string,
  override: { reason: string } | null,
) {
  const remaining = await currentConflicts(tx, sectionId);
  await tx.courseSection.update({
    where: { id: sectionId },
    data: remaining.length
      ? override
        ? { scheduleOverrideReason: override.reason }
        : {}
      : { scheduleOverrideReason: null },
  });
}

export async function setMeetings(
  actor: ActorContext,
  id: string,
  input: z.output<typeof sectionMeetingsSchema>,
) {
  const s = await load(id);
  const target = targetOf(s);
  assertInScope(actor, 'section:update', target);
  assertEditable(s);
  const roomIds = [
    ...new Set(input.meetings.flatMap((m) => (m.classroomId ? [m.classroomId] : []))),
  ];
  const rooms = await prisma.classroom.findMany({ where: { id: { in: roomIds } } });
  if (rooms.length !== roomIds.length) throw invalid('meetings', 'Unknown classroom');
  const inactive = rooms.filter((r) => r.status !== 'ACTIVE');
  if (inactive.length)
    throw invalid(
      'meetings',
      `Classroom ${inactive[0]!.building} ${inactive[0]!.roomNumber} is not active`,
    );
  const warnings = rooms
    .filter((r) => r.capacity < s.capacity)
    .map(
      (r) =>
        `${r.building} ${r.roomNumber} seats ${r.capacity}, fewer than the section capacity of ${s.capacity}`,
    );
  const conflicts = await prisma.$transaction(async (tx) => {
    await lockSessionSchedule(tx, s.sessionId);
    const found = await findConflicts(tx, {
      sessionId: s.sessionId,
      sectionId: id,
      meetings: input.meetings,
      instructorIds: s.instructors.map((i) => i.facultyMemberId),
    });
    resolveConflicts(actor, target, found, input.override);
    await tx.sectionMeeting.deleteMany({ where: { sectionId: id } });
    await tx.sectionMeeting.createMany({
      data: input.meetings.map((m) => ({ sectionId: id, ...m })),
    });
    await recordOverrideState(tx, id, found.length ? input.override : null);
    await recordAudit(
      actor,
      {
        action: found.length ? 'section.meetings_set_with_override' : 'section.meetings_set',
        entityType: 'CourseSection',
        entityId: id,
        changes: {
          meetings: input.meetings,
          ...(found.length ? { conflicts: found, overrideReason: input.override!.reason } : {}),
        } as never,
      },
      tx,
    );
    return found;
  });
  return { ...toDto(await load(id), actor), warnings, overriddenConflicts: conflicts };
}

/** Credits taught by each instructor in a session (excluding cancelled sections and one section). */
async function teachingLoad(sessionId: string, facultyIds: string[], exceptSectionId: string) {
  const rows = await prisma.sectionInstructor.findMany({
    where: {
      facultyMemberId: { in: facultyIds },
      role: { in: ['PRIMARY', 'SECONDARY'] },
      section: { sessionId, status: { not: 'CANCELLED' }, id: { not: exceptSectionId } },
    },
    select: {
      facultyMemberId: true,
      section: { select: { course: { select: { credits: true } } } },
    },
  });
  const load = new Map<string, number>();
  for (const r of rows)
    load.set(
      r.facultyMemberId,
      (load.get(r.facultyMemberId) ?? 0) + r.section.course.credits.toNumber(),
    );
  return load;
}

export async function setInstructors(
  actor: ActorContext,
  id: string,
  input: z.output<typeof sectionInstructorsSchema>,
) {
  const s = await load(id);
  const target = targetOf(s);
  assertInScope(actor, 'section:assign_faculty', target);
  assertEditable(s);
  const ids = input.instructors.map((i) => i.facultyMemberId);
  const faculty = await prisma.facultyMember.findMany({
    where: { id: { in: ids } },
    include: { user: { select: { firstName: true, lastName: true } } },
  });
  if (faculty.length !== ids.length) throw invalid('instructors', 'Unknown faculty member');
  const inactive = faculty.find((f) => f.employmentStatus === 'INACTIVE');
  if (inactive)
    throw invalid(
      'instructors',
      `${inactive.user.firstName} ${inactive.user.lastName} is no longer active`,
    );
  const hasPrimary = input.instructors.some((i) => i.role === 'PRIMARY');
  if (
    s.status !== 'DRAFT' &&
    !hasPrimary &&
    !covers(actor.grants, 'section:publish_without_instructor', target)
  )
    throw invalid('instructors', 'A published section needs a primary instructor');
  // Workload warnings (FR-CRS-008): non-blocking.
  const teaching = input.instructors.filter((i) => i.role !== 'TA').map((i) => i.facultyMemberId);
  const loadBy = await teachingLoad(s.sessionId, teaching, id);
  const credits = num(s.course.credits)!;
  const warnings: string[] = [];
  for (const f of faculty) {
    if (!teaching.includes(f.id) || f.maxLoadCredits === null) continue;
    const total = (loadBy.get(f.id) ?? 0) + credits;
    if (total > f.maxLoadCredits.toNumber())
      warnings.push(
        `${f.user.firstName} ${f.user.lastName} would teach ${total} credits, above their limit of ${f.maxLoadCredits.toNumber()}`,
      );
    if (f.employmentStatus === 'ON_LEAVE')
      warnings.push(`${f.user.firstName} ${f.user.lastName} is on leave`);
  }
  const conflicts = await prisma.$transaction(async (tx) => {
    await lockSessionSchedule(tx, s.sessionId);
    const found = (
      await findConflicts(tx, {
        sessionId: s.sessionId,
        sectionId: id,
        meetings: s.meetings.map((m) => ({ ...m, classroomId: null })),
        instructorIds: ids,
      })
    ).filter((c) => c.kind === 'INSTRUCTOR');
    resolveConflicts(actor, target, found, input.override);
    await tx.sectionInstructor.deleteMany({ where: { sectionId: id } });
    await tx.sectionInstructor.createMany({
      data: input.instructors.map((i) => ({
        sectionId: id,
        facultyMemberId: i.facultyMemberId,
        role: i.role,
      })),
    });
    await recordOverrideState(tx, id, found.length ? input.override : null);
    await recordAudit(
      actor,
      {
        action: found.length ? 'section.instructors_set_with_override' : 'section.instructors_set',
        entityType: 'CourseSection',
        entityId: id,
        changes: {
          from: s.instructors.map((i) => ({ facultyMemberId: i.facultyMemberId, role: i.role })),
          to: input.instructors,
          ...(found.length ? { conflicts: found, overrideReason: input.override!.reason } : {}),
        } as never,
      },
      tx,
    );
    return found;
  });
  // Roster access and section conversations follow assignments once those exist (BR-010, Phases 7/9).
  return { ...toDto(await load(id), actor), warnings, overriddenConflicts: conflicts };
}

export async function setSectionRestrictions(
  actor: ActorContext,
  id: string,
  restrictions: RestrictionLike[],
) {
  const s = await load(id);
  assertInScope(actor, 'section:update', targetOf(s));
  assertEditable(s);
  await assertRestrictionTargets(restrictions);
  await prisma.$transaction(async (tx) => {
    await tx.courseRestriction.deleteMany({ where: { sectionId: id } });
    await tx.courseRestriction.createMany({
      data: restrictions.map((r) => ({ sectionId: id, ...r })),
    });
    await recordAudit(
      actor,
      {
        action: 'section.restrictions_set',
        entityType: 'CourseSection',
        entityId: id,
        changes: { restrictions } as never,
      },
      tx,
    );
  });
  return getSection(actor, id);
}

const TRANSITIONS: Record<
  SectionAction,
  { from: SectionStatus[]; to: SectionStatus; permission: PermissionKey }
> = {
  publish: { from: ['DRAFT'], to: 'PUBLISHED', permission: 'section:publish' },
  close: { from: ['PUBLISHED'], to: 'CLOSED', permission: 'section:publish' },
  reopen: { from: ['CLOSED'], to: 'PUBLISHED', permission: 'section:publish' },
  cancel: { from: ['DRAFT', 'PUBLISHED', 'CLOSED'], to: 'CANCELLED', permission: 'section:cancel' },
  complete: { from: ['PUBLISHED', 'CLOSED'], to: 'COMPLETED', permission: 'section:publish' },
};

export async function transitionSection(
  actor: ActorContext,
  id: string,
  input: { action: SectionAction; reason: string | null },
) {
  const s = await load(id);
  const target = targetOf(s);
  const rule = TRANSITIONS[input.action];
  assertInScope(actor, rule.permission, target);
  if (!rule.from.includes(s.status))
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      `Cannot ${input.action} a ${s.status.toLowerCase()} section`,
      { from: s.status, action: input.action },
    );
  if (input.action === 'publish' || input.action === 'reopen') {
    if (s.course.status !== 'ACTIVE')
      throw new BusinessRuleError(
        ErrorCode.INVALID_STATE_TRANSITION,
        'Activate the course before publishing its sections',
      );
    if (s.session.status !== 'PLANNED' && s.session.status !== 'ACTIVE')
      throw new BusinessRuleError(
        ErrorCode.INVALID_STATE_TRANSITION,
        'The session is no longer open for scheduling',
      );
    // BR-014: publishing without a primary instructor needs a dedicated permission.
    if (
      !s.instructors.some((i) => i.role === 'PRIMARY') &&
      !covers(actor.grants, 'section:publish_without_instructor', target)
    )
      throw new BusinessRuleError(
        ErrorCode.INVALID_STATE_TRANSITION,
        'Assign a primary instructor before publishing',
        {
          missing: 'primaryInstructor',
        },
      );
  }
  if (input.action === 'complete') {
    const ended =
      s.session.status === 'COMPLETED' || isoDate(s.session.endDate) < isoDate(new Date());
    if (!ended)
      throw new BusinessRuleError(
        ErrorCode.INVALID_STATE_TRANSITION,
        'Sections can be completed once the session has ended',
      );
  }
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM course_sections WHERE id = ${id}::uuid FOR UPDATE`;
    if (input.action === 'publish' || input.action === 'reopen') {
      // Schedules copied by roll-forward (or edited elsewhere) may clash; publishing
      // needs a conflict-free schedule or an explicit override recorded on the section.
      await lockSessionSchedule(tx, s.sessionId);
      const conflicts = await currentConflicts(tx, id);
      if (conflicts.length && !s.scheduleOverrideReason)
        throw new ConflictError(
          conflicts.some((c) => c.kind === 'CLASSROOM')
            ? ErrorCode.CLASSROOM_CONFLICT
            : ErrorCode.INSTRUCTOR_CONFLICT,
          'Resolve or override the scheduling conflicts before publishing',
          { conflicts, canOverride: false },
        );
    }
    await tx.courseSection.update({
      where: { id },
      data: {
        status: rule.to,
        ...(input.action === 'publish' ? { publishedAt: now } : {}),
        ...(input.action === 'cancel'
          ? { cancelledAt: now, cancelReason: input.reason, registrationOpen: false }
          : {}),
      },
    });
    // Cancelling also cancels registrations and waitlist entries and notifies people
    // once registrations exist (FR-CRS-010, BR-009; Phase 6/9).
    await recordAudit(
      actor,
      {
        action: `section.${input.action === 'cancel' ? 'cancelled' : input.action === 'publish' ? 'published' : input.action === 'close' ? 'closed' : input.action === 'reopen' ? 'reopened' : 'completed'}`,
        entityType: 'CourseSection',
        entityId: id,
        changes: { from: s.status, to: rule.to, ...(input.reason ? { reason: input.reason } : {}) },
      },
      tx,
    );
  });
  return toDto(await load(id), actor);
}

/** Copies sections into another session as drafts (FR-CRS-011). */
export async function rollForward(actor: ActorContext, input: z.output<typeof rollForwardSchema>) {
  const from = await prisma.academicSession.findUnique({ where: { id: input.fromSessionId } });
  if (!from) throw invalid('fromSessionId', 'Unknown academic session');
  const to = await assertSchedulableSession(input.toSessionId, 'toSessionId');
  const filter = scopeFilter(actor.grants, 'section:create');
  if (filter && !filter.departmentIds.length && !filter.schoolIds.length)
    throw new ForbiddenError();
  if (input.departmentId) {
    const dept = await prisma.department.findUnique({ where: { id: input.departmentId } });
    if (!dept) throw invalid('departmentId', 'Unknown department');
    assertInScope(actor, 'section:create', { departmentId: dept.id, schoolId: dept.schoolId });
  }
  const sources = await prisma.courseSection.findMany({
    where: {
      sessionId: from.id,
      status: { not: 'CANCELLED' },
      course: {
        ...(input.departmentId ? { departmentId: input.departmentId } : {}),
        ...(filter
          ? {
              OR: [
                { departmentId: { in: filter.departmentIds } },
                { department: { schoolId: { in: filter.schoolIds } } },
              ],
            }
          : {}),
      },
    },
    include: {
      course: { select: { code: true, status: true } },
      meetings: { include: { classroom: { select: { status: true } } } },
      instructors: { include: { facultyMember: { select: { employmentStatus: true } } } },
      restrictions: true,
    },
    orderBy: [{ course: { code: 'asc' } }, { sectionCode: 'asc' }],
  });
  const existing = new Set(
    (
      await prisma.courseSection.findMany({
        where: { sessionId: to.id },
        select: { courseId: true, sectionCode: true },
      })
    ).map((s) => `${s.courseId}:${s.sectionCode}`),
  );
  const created: Array<{ id: string; course: string; sectionCode: string; conflicts: number }> = [];
  const skipped: Array<{ course: string; sectionCode: string; reason: string }> = [];
  for (const src of sources) {
    const label = { course: src.course.code, sectionCode: src.sectionCode };
    if (src.course.status !== 'ACTIVE') {
      skipped.push({ ...label, reason: 'Course is not active' });
      continue;
    }
    if (existing.has(`${src.courseId}:${src.sectionCode}`)) {
      skipped.push({ ...label, reason: 'Already exists in the target session' });
      continue;
    }
    const meetings = src.meetings.map((m) => ({
      dayOfWeek: m.dayOfWeek,
      startMinute: m.startMinute,
      endMinute: m.endMinute,
      type: m.type,
      classroomId: m.classroom?.status === 'ACTIVE' ? m.classroomId : null,
    }));
    const instructors = input.includeInstructors
      ? src.instructors.filter((i) => i.facultyMember.employmentStatus !== 'INACTIVE')
      : [];
    const result = await prisma.$transaction(async (tx) => {
      await lockSessionSchedule(tx, to.id);
      const conflicts = await findConflicts(tx, {
        sessionId: to.id,
        sectionId: null,
        meetings,
        instructorIds: instructors.map((i) => i.facultyMemberId),
      });
      const s = await tx.courseSection.create({
        data: {
          courseId: src.courseId,
          sessionId: to.id,
          sectionCode: src.sectionCode,
          capacity: src.capacity,
          waitlistCapacity: src.waitlistCapacity,
          campusId: src.campusId,
          notes: src.notes,
          registrationOpen: true,
          meetings: { create: meetings },
          instructors: {
            create: instructors.map((i) => ({ facultyMemberId: i.facultyMemberId, role: i.role })),
          },
          restrictions: {
            create: src.restrictions.map((r) => ({
              mode: r.mode,
              targetType: r.targetType,
              targetId: r.targetId,
              targetValue: r.targetValue,
            })),
          },
        },
      });
      return { id: s.id, conflicts: conflicts.length };
    });
    created.push({ ...label, ...result });
  }
  await recordAudit(actor, {
    action: 'section.rolled_forward',
    entityType: 'AcademicSession',
    entityId: to.id,
    changes: {
      from: from.code,
      to: to.code,
      departmentId: input.departmentId,
      created: created.length,
      skipped: skipped.length,
    },
  });
  return { created, skipped, withConflicts: created.filter((c) => c.conflicts > 0).length };
}

/** Weekly teaching schedule and load of a faculty member in a session. */
export async function facultySchedule(
  actor: ActorContext,
  facultyMemberId: string,
  sessionId: string,
) {
  const f = await prisma.facultyMember.findUnique({
    where: { id: facultyMemberId },
    include: { department: true },
  });
  if (!f) throw new NotFoundError('Faculty member');
  const target = { departmentId: f.departmentId, schoolId: f.department.schoolId };
  const allowed =
    f.userId === actor.userId ||
    covers(actor.grants, 'faculty:read', target) ||
    seesAllSections(actor);
  if (!allowed) throw new ForbiddenError();
  const rows = await prisma.courseSection.findMany({
    where: { sessionId, status: { not: 'CANCELLED' }, instructors: { some: { facultyMemberId } } },
    include,
    orderBy: { course: { code: 'asc' } },
  });
  const sections = rows.map((r) => ({
    ...toDto(r, actor),
    role: r.instructors.find((i) => i.facultyMemberId === facultyMemberId)!.role,
  }));
  const totalCredits = sections
    .filter((s) => s.role !== 'TA')
    .reduce((sum, s) => sum + s.course.credits, 0);
  return { sections, totalCredits, maxLoadCredits: num(f.maxLoadCredits) };
}
