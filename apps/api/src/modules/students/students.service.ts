import type { z } from 'zod';
import {
  ErrorCode,
  type holdCreateSchema,
  type holdReleaseSchema,
  type programChangeSchema,
  type studentContactSchema,
  type studentCreateSchema,
  type studentSelfUpdateSchema,
  type studentStatusSchema,
  type studentUpdateSchema,
} from '@ucrams/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext } from '../../common/context/actor.js';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/exceptions/app-error.js';
import { isoDate, paging } from '../../common/http/list-query.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { diffChanges, recordAudit } from '../audit/audit.service.js';
import { revokeSessions } from '../auth/session.service.js';
import { assertInScope, covers, type ScopeTarget } from '../authz/authz.js';
import { invalidateAuthState } from '../authz/grants.service.js';
import { avatarUrl } from '../files/files.service.js';
import { generateStudentNumber } from '../users/id-sequences.js';
import { createInvitedUser, sendInvitations } from '../users/provisioning.js';
import { departmentWhere } from '../users/user-scope.js';
import { accountSummary } from '../users/users.service.js';

const invalid = (path: string, message: string) =>
  new BusinessRuleError(ErrorCode.VALIDATION_ERROR, message, {
    fields: [{ path: `body.${path}`, message }],
  });

// ----- loading & DTOs --------------------------------------------------------------

const detailInclude = {
  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      status: true,
      avatarFileId: true,
    },
  },
  program: {
    select: {
      id: true,
      code: true,
      name: true,
      totalCredits: true,
      department: { select: { id: true, code: true, name: true, schoolId: true } },
    },
  },
  specialization: { select: { id: true, code: true, name: true } },
  admissionSession: { select: { id: true, code: true, name: true } },
  contact: true,
  holds: {
    orderBy: { placedAt: 'desc' as const },
    include: {
      placedBy: { select: { firstName: true, lastName: true } },
      releasedBy: { select: { firstName: true, lastName: true } },
    },
  },
  programHistory: {
    orderBy: { createdAt: 'desc' as const },
    include: {
      fromProgram: { select: { code: true, name: true } },
      toProgram: { select: { code: true, name: true } },
      effectiveSession: { select: { code: true } },
      changedBy: { select: { firstName: true, lastName: true } },
    },
  },
} as const;
type StudentRow = Prisma.StudentGetPayload<{ include: typeof detailInclude }>;

const targetOf = (s: {
  program: { department: { id: string; schoolId: string } };
}): ScopeTarget => ({
  departmentId: s.program.department.id,
  schoolId: s.program.department.schoolId,
});

function contactDto(c: StudentRow['contact']) {
  return {
    personalEmail: c?.personalEmail ?? null,
    dateOfBirth: c?.dateOfBirth ? isoDate(c.dateOfBirth) : null,
    addressLine: c?.addressLine ?? null,
    city: c?.city ?? null,
    state: c?.state ?? null,
    postalCode: c?.postalCode ?? null,
    country: c?.country ?? null,
    emergencyContactName: c?.emergencyContactName ?? null,
    emergencyContactPhone: c?.emergencyContactPhone ?? null,
    emergencyContactRelation: c?.emergencyContactRelation ?? null,
  };
}

const name = (u: { firstName: string; lastName: string } | null) =>
  u ? `${u.firstName} ${u.lastName}` : null;

async function toDetail(actor: ActorContext, s: StudentRow) {
  const self = s.userId === actor.userId;
  const target = targetOf(s);
  const can = {
    edit: covers(actor.grants, 'student:update', target),
    manageHolds: covers(actor.grants, 'student:manage_holds', target),
    readSensitive: self || covers(actor.grants, 'student:read_sensitive', target),
    manageAccount: covers(actor.grants, 'user:manage_status', target),
  };
  const isAdminView = covers(actor.grants, 'student:read', target);
  return {
    id: s.id,
    userId: s.userId,
    studentNumber: s.studentNumber,
    firstName: s.user.firstName,
    lastName: s.user.lastName,
    email: s.user.email,
    avatarUrl: await avatarUrl(s.user.avatarFileId),
    program: {
      id: s.program.id,
      code: s.program.code,
      name: s.program.name,
      totalCredits: s.program.totalCredits.toNumber(),
    },
    department: s.program.department,
    specialization: s.specialization,
    admissionSession: s.admissionSession,
    admissionDate: s.admissionDate ? isoDate(s.admissionDate) : null,
    expectedGraduationYear: s.expectedGraduationYear,
    yearOfStudy: s.yearOfStudy,
    cohort: s.cohort,
    status: s.status,
    phone: s.phone,
    contact: can.readSensitive ? contactDto(s.contact) : null,
    activeHolds: s.holds.filter((h) => !h.releasedAt).length,
    holds: s.holds.map((h) => ({
      id: h.id,
      type: h.type,
      // Hold reasons are sensitive (USER_ROLES_AND_PERMISSIONS: student:read_sensitive).
      reason: can.readSensitive ? h.reason : null,
      placedAt: h.placedAt.toISOString(),
      placedBy: isAdminView ? name(h.placedBy) : null,
      releasedAt: h.releasedAt?.toISOString() ?? null,
      releasedBy: isAdminView ? name(h.releasedBy) : null,
      releaseNote: can.readSensitive ? h.releaseNote : null,
    })),
    programHistory: s.programHistory.map((h) => ({
      id: h.id,
      from: h.fromProgram,
      to: h.toProgram,
      effectiveSession: h.effectiveSession?.code ?? null,
      reason: isAdminView || self ? h.reason : null,
      changedBy: isAdminView ? name(h.changedBy) : null,
      createdAt: h.createdAt.toISOString(),
    })),
    account: isAdminView ? await accountSummary(s.userId) : null,
    permissions: can,
    createdAt: s.createdAt.toISOString(),
  };
}

async function loadStudent(id: string) {
  const s = await prisma.student.findUnique({ where: { id }, include: detailInclude });
  if (!s) throw new NotFoundError('Student');
  return s;
}

/** Admins in scope, or the student themself. Others get 404 (no ID probing). */
export async function getStudent(actor: ActorContext, id: string) {
  const s = await loadStudent(id);
  if (s.userId !== actor.userId && !covers(actor.grants, 'student:read', targetOf(s)))
    throw new NotFoundError('Student');
  return toDetail(actor, s);
}

export async function getOwnStudent(actor: ActorContext) {
  const s = await prisma.student.findUnique({
    where: { userId: actor.userId },
    include: detailInclude,
  });
  if (!s) throw new NotFoundError('Student profile');
  return toDetail(actor, s);
}

export interface StudentListQuery {
  page: number;
  limit: number;
  q?: string;
  programId?: string;
  departmentId?: string;
  schoolId?: string;
  yearOfStudy?: number;
  status?: string;
  hasHold?: boolean;
  sort: { field: 'studentNumber' | 'lastName' | 'createdAt'; direction: 'asc' | 'desc' }[];
}

export async function listStudents(actor: ActorContext, q: StudentListQuery) {
  const scope = departmentWhere(actor, 'student:read');
  const where: Prisma.StudentWhereInput = {
    AND: [
      scope ? { program: { department: scope } } : {},
      q.q
        ? {
            OR: [
              { studentNumber: { contains: q.q, mode: 'insensitive' } },
              { user: { email: { contains: q.q, mode: 'insensitive' } } },
              { user: { firstName: { contains: q.q, mode: 'insensitive' } } },
              { user: { lastName: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {},
      q.programId ? { programId: q.programId } : {},
      q.departmentId ? { program: { departmentId: q.departmentId } } : {},
      q.schoolId ? { program: { department: { schoolId: q.schoolId } } } : {},
      q.yearOfStudy ? { yearOfStudy: q.yearOfStudy } : {},
      q.status ? { status: q.status as never } : {},
      q.hasHold === undefined
        ? {}
        : q.hasHold
          ? { holds: { some: { releasedAt: null } } }
          : { holds: { none: { releasedAt: null } } },
    ],
  };
  const orderBy = q.sort.map((s) =>
    s.field === 'lastName' ? { user: { lastName: s.direction } } : { [s.field]: s.direction },
  );
  const [total, rows] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      orderBy,
      ...paging(q),
      include: {
        user: { select: { email: true, firstName: true, lastName: true, status: true } },
        program: {
          select: {
            id: true,
            code: true,
            name: true,
            department: { select: { id: true, code: true, name: true } },
          },
        },
        specialization: { select: { code: true, name: true } },
        _count: { select: { holds: { where: { releasedAt: null } } } },
      },
    }),
  ]);
  return {
    total,
    items: rows.map((s) => ({
      id: s.id,
      studentNumber: s.studentNumber,
      firstName: s.user.firstName,
      lastName: s.user.lastName,
      email: s.user.email,
      program: { id: s.program.id, code: s.program.code, name: s.program.name },
      department: s.program.department,
      specialization: s.specialization,
      yearOfStudy: s.yearOfStudy,
      status: s.status,
      accountStatus: s.user.status,
      activeHolds: s._count.holds,
    })),
  };
}

// ----- create & update --------------------------------------------------------------

async function resolvePlacement(input: { programId: string; specializationId?: string | null }) {
  const program = await prisma.program.findUnique({
    where: { id: input.programId },
    include: { department: { select: { id: true, code: true, schoolId: true } } },
  });
  if (!program) throw invalid('programId', 'Unknown program');
  if (program.status !== 'ACTIVE') throw invalid('programId', 'This program is not active');
  if (input.specializationId) {
    const spec = await prisma.specialization.findUnique({ where: { id: input.specializationId } });
    if (!spec || spec.programId !== program.id)
      throw invalid('specializationId', 'Choose a specialization of the selected program');
    if (spec.status !== 'ACTIVE')
      throw invalid('specializationId', 'This specialization is not active');
  }
  return program;
}

function contactData(
  c: z.output<typeof studentContactSchema> | Partial<z.output<typeof studentContactSchema>>,
) {
  const { dateOfBirth, ...rest } = c;
  return {
    ...rest,
    ...(dateOfBirth !== undefined
      ? { dateOfBirth: dateOfBirth ? new Date(`${dateOfBirth}T00:00:00Z`) : null }
      : {}),
  };
}

export async function createStudent(
  actor: ActorContext,
  input: z.output<typeof studentCreateSchema>,
) {
  const program = await resolvePlacement(input);
  assertInScope(actor, 'student:create', {
    departmentId: program.department.id,
    schoolId: program.department.schoolId,
  });
  if (
    input.contact &&
    !covers(actor.grants, 'student:read_sensitive', {
      departmentId: program.department.id,
      schoolId: program.department.schoolId,
    })
  ) {
    throw new ForbiddenError('You cannot record sensitive contact details');
  }
  let admissionYear = new Date().getUTCFullYear();
  if (input.admissionSessionId) {
    const session = await prisma.academicSession.findUnique({
      where: { id: input.admissionSessionId },
    });
    if (!session) throw invalid('admissionSessionId', 'Unknown session');
    admissionYear = session.startDate.getUTCFullYear();
  }
  if (
    input.studentNumber &&
    (await prisma.student.findUnique({ where: { studentNumber: input.studentNumber } }))
  ) {
    throw new ConflictError(ErrorCode.UNIQUE_VIOLATION, 'This student number is already used', {
      fields: [{ path: 'body.studentNumber', message: 'Already in use' }],
    });
  }
  const student = await prisma.$transaction(async (tx) => {
    const user = await createInvitedUser(tx, {
      ...input,
      role: 'STUDENT',
      assignedById: actor.userId,
    });
    const s = await tx.student.create({
      data: {
        userId: user.id,
        studentNumber:
          input.studentNumber ??
          (await generateStudentNumber(program.department.code, admissionYear, tx)),
        programId: program.id,
        specializationId: input.specializationId,
        admissionSessionId: input.admissionSessionId,
        admissionDate: input.admissionDate ? new Date(`${input.admissionDate}T00:00:00Z`) : null,
        expectedGraduationYear: input.expectedGraduationYear,
        yearOfStudy: input.yearOfStudy,
        cohort: input.cohort,
        phone: input.phone,
        ...(input.contact ? { contact: { create: contactData(input.contact) } } : {}),
      },
    });
    await recordAudit(
      actor,
      {
        action: 'student.created',
        entityType: 'Student',
        entityId: s.id,
        changes: {
          studentNumber: s.studentNumber,
          programId: s.programId,
          userId: user.id,
          email: input.email,
        },
      },
      tx,
    );
    return s;
  });
  if (input.sendInvite) await sendInvitations([student.userId]);
  return getStudent(actor, student.id);
}

export async function updateStudent(
  actor: ActorContext,
  id: string,
  input: z.output<typeof studentUpdateSchema>,
) {
  const before = await loadStudent(id);
  const target = targetOf(before);
  assertInScope(actor, 'student:update', target);
  if (input.contact && !covers(actor.grants, 'student:read_sensitive', target)) {
    throw new ForbiddenError('You cannot change sensitive contact details');
  }
  const { firstName, lastName, contact, admissionDate, ...studentFields } = input;
  await prisma.$transaction(async (tx) => {
    if (firstName || lastName)
      await tx.user.update({ where: { id: before.userId }, data: { firstName, lastName } });
    const after = await tx.student.update({
      where: { id },
      data: {
        ...studentFields,
        ...(admissionDate !== undefined
          ? { admissionDate: admissionDate ? new Date(`${admissionDate}T00:00:00Z`) : null }
          : {}),
        ...(contact
          ? { contact: { upsert: { create: contactData(contact), update: contactData(contact) } } }
          : {}),
      },
    });
    const changes = diffChanges(
      { ...before, firstName: before.user.firstName, lastName: before.user.lastName },
      {
        ...after,
        firstName: firstName ?? before.user.firstName,
        lastName: lastName ?? before.user.lastName,
      },
    );
    // Contact details are audited by field name only.
    if (contact) Object.assign(changes, { contact: { from: '[REDACTED]', to: '[REDACTED]' } });
    for (const k of [
      'updatedAt',
      'user',
      'program',
      'specialization',
      'admissionSession',
      'holds',
      'programHistory',
    ])
      delete changes[k];
    await recordAudit(
      actor,
      { action: 'student.updated', entityType: 'Student', entityId: id, changes: changes as never },
      tx,
    );
  });
  return getStudent(actor, id);
}

/** Program/specialization change (BR-011/012): completed records are kept; history is appended. */
export async function changeProgram(
  actor: ActorContext,
  id: string,
  input: z.output<typeof programChangeSchema>,
) {
  const before = await loadStudent(id);
  assertInScope(actor, 'student:update', targetOf(before));
  const program = await resolvePlacement(input);
  assertInScope(actor, 'student:update', {
    departmentId: program.department.id,
    schoolId: program.department.schoolId,
  });
  if (
    program.id === before.programId &&
    (input.specializationId ?? null) === before.specializationId
  ) {
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      'The student is already in this program and specialization',
    );
  }
  if (
    input.effectiveSessionId &&
    !(await prisma.academicSession.findUnique({ where: { id: input.effectiveSessionId } }))
  ) {
    throw invalid('effectiveSessionId', 'Unknown session');
  }
  await prisma.$transaction(async (tx) => {
    await tx.student.update({
      where: { id },
      data: { programId: program.id, specializationId: input.specializationId },
    });
    await tx.studentProgramHistory.create({
      data: {
        studentId: id,
        fromProgramId: before.programId,
        toProgramId: program.id,
        fromSpecializationId: before.specializationId,
        toSpecializationId: input.specializationId,
        effectiveSessionId: input.effectiveSessionId,
        reason: input.reason,
        changedById: actor.userId,
      },
    });
    await recordAudit(
      actor,
      {
        action: 'student.program_changed',
        entityType: 'Student',
        entityId: id,
        changes: {
          programId: { from: before.programId, to: program.id },
          specializationId: { from: before.specializationId, to: input.specializationId },
          reason: input.reason,
        },
      },
      tx,
    );
  });
  return getStudent(actor, id);
}

/**
 * Academic status (FR-USER-004/008). Suspension and dismissal also lock the
 * account and revoke sessions; returning to another status restores an account
 * that was locked this way.
 */
export async function setStudentStatus(
  actor: ActorContext,
  id: string,
  input: z.output<typeof studentStatusSchema>,
) {
  const s = await loadStudent(id);
  assertInScope(actor, 'student:update', targetOf(s));
  if (s.status === input.status)
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      `The student is already ${input.status.toLowerCase()}`,
    );
  const user = await prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
  const accountStatus =
    input.status === 'SUSPENDED'
      ? 'SUSPENDED'
      : input.status === 'DISMISSED'
        ? 'DEACTIVATED'
        : (s.status === 'SUSPENDED' || s.status === 'DISMISSED') && user.status !== 'INVITED'
          ? user.passwordHash
            ? 'ACTIVE'
            : 'INVITED'
          : user.status;
  await prisma.$transaction(async (tx) => {
    await tx.student.update({ where: { id }, data: { status: input.status } });
    if (accountStatus !== user.status)
      await tx.user.update({ where: { id: s.userId }, data: { status: accountStatus } });
    await recordAudit(
      actor,
      {
        action: 'student.status_changed',
        entityType: 'Student',
        entityId: id,
        changes: {
          from: s.status,
          to: input.status,
          accountStatus: { from: user.status, to: accountStatus },
          reason: input.reason,
        },
      },
      tx,
    );
  });
  if (accountStatus === 'SUSPENDED' || accountStatus === 'DEACTIVATED')
    await revokeSessions({ userId: s.userId }, 'ACCOUNT_INACTIVE');
  await invalidateAuthState([s.userId]);
  return getStudent(actor, id);
}

// ----- holds ---------------------------------------------------------------------------

export async function placeHold(
  actor: ActorContext,
  studentId: string,
  input: z.output<typeof holdCreateSchema>,
) {
  const s = await loadStudent(studentId);
  assertInScope(actor, 'student:manage_holds', targetOf(s));
  if (s.holds.some((h) => !h.releasedAt && h.type === input.type)) {
    throw new ConflictError(
      ErrorCode.CONFLICT,
      `The student already has an active ${input.type.toLowerCase()} hold`,
    );
  }
  await prisma.$transaction(async (tx) => {
    const hold = await tx.registrationHold.create({
      data: { studentId, ...input, placedById: actor.userId },
    });
    await recordAudit(
      actor,
      {
        action: 'student.hold_placed',
        entityType: 'Student',
        entityId: studentId,
        changes: { holdId: hold.id, type: input.type },
      },
      tx,
    );
  });
  return getStudent(actor, studentId);
}

export async function releaseHold(
  actor: ActorContext,
  studentId: string,
  holdId: string,
  input: z.output<typeof holdReleaseSchema>,
) {
  const s = await loadStudent(studentId);
  assertInScope(actor, 'student:manage_holds', targetOf(s));
  const hold = s.holds.find((h) => h.id === holdId);
  if (!hold) throw new NotFoundError('Hold');
  if (hold.releasedAt)
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      'This hold was already released',
    );
  await prisma.$transaction(async (tx) => {
    await tx.registrationHold.update({
      where: { id: holdId },
      data: { releasedAt: new Date(), releasedById: actor.userId, releaseNote: input.note },
    });
    await recordAudit(
      actor,
      {
        action: 'student.hold_released',
        entityType: 'Student',
        entityId: studentId,
        changes: { holdId, type: hold.type },
      },
      tx,
    );
  });
  return getStudent(actor, studentId);
}

// ----- self-service ----------------------------------------------------------------------

export async function updateOwnStudent(
  actor: ActorContext,
  input: z.output<typeof studentSelfUpdateSchema>,
) {
  const s = await prisma.student.findUnique({ where: { userId: actor.userId } });
  if (!s) throw new NotFoundError('Student profile');
  await prisma.$transaction(async (tx) => {
    await tx.student.update({
      where: { id: s.id },
      data: {
        phone: input.phone,
        contact: {
          upsert: { create: contactData(input.contact), update: contactData(input.contact) },
        },
      },
    });
    await recordAudit(
      actor,
      {
        action: 'student.self_updated',
        entityType: 'Student',
        entityId: s.id,
        changes: { fields: ['phone', 'contact'] },
      },
      tx,
    );
  });
  return getOwnStudent(actor);
}
