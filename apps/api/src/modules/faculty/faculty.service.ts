import type { z } from 'zod';
import {
  ErrorCode,
  type facultyCreateSchema,
  type facultySelfUpdateSchema,
  type facultyUpdateSchema,
} from '@ucrams/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext } from '../../common/context/actor.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../common/exceptions/app-error.js';
import { isoDate, num, paging } from '../../common/http/list-query.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { diffChanges, recordAudit } from '../audit/audit.service.js';
import { assertInScope, covers } from '../authz/authz.js';
import { avatarUrl } from '../files/files.service.js';
import { generateEmployeeNumber } from '../users/id-sequences.js';
import { createInvitedUser, sendInvitations } from '../users/provisioning.js';
import { departmentWhere } from '../users/user-scope.js';
import { accountSummary } from '../users/users.service.js';

const invalid = (path: string, message: string) =>
  new BusinessRuleError(ErrorCode.VALIDATION_ERROR, message, {
    fields: [{ path: `body.${path}`, message }],
  });

const include = {
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
  department: { select: { id: true, code: true, name: true, schoolId: true } },
  secondaryDepartments: {
    select: { department: { select: { id: true, code: true, name: true, schoolId: true } } },
  },
  headOf: { select: { id: true, name: true } },
  deanOf: { select: { id: true, name: true } },
} as const;
type Row = Prisma.FacultyMemberGetPayload<{ include: typeof include }>;

const targets = (f: Pick<Row, 'department' | 'secondaryDepartments'>) => [
  { departmentId: f.department.id, schoolId: f.department.schoolId },
  ...f.secondaryDepartments.map((s) => ({
    departmentId: s.department.id,
    schoolId: s.department.schoolId,
  })),
];
const coversAny = (
  actor: ActorContext,
  perm: Parameters<typeof covers>[1],
  f: Pick<Row, 'department' | 'secondaryDepartments'>,
) => targets(f).some((t) => covers(actor.grants, perm, t));

/** Directory fields: visible to every signed-in user (USER_ROLES_AND_PERMISSIONS: faculty:read). */
async function directoryDto(f: Row) {
  return {
    id: f.id,
    userId: f.userId,
    firstName: f.user.firstName,
    lastName: f.user.lastName,
    email: f.user.email,
    avatarUrl: await avatarUrl(f.user.avatarFileId),
    designation: f.designation,
    department: f.department,
    secondaryDepartments: f.secondaryDepartments.map((s) => s.department),
    specialization: f.specialization,
    researchInterests: f.researchInterests,
    qualifications: f.qualifications,
    officeLocation: f.officeLocation,
    officeHours: f.officeHours,
    headOf: f.headOf,
    deanOf: f.deanOf,
  };
}

async function detailDto(actor: ActorContext, f: Row) {
  const self = f.userId === actor.userId;
  const admin = coversAny(actor, 'faculty:read', f);
  const base = await directoryDto(f);
  if (!self && !admin) return { ...base, restricted: true as const };
  return {
    ...base,
    restricted: false as const,
    employeeNumber: f.employeeNumber,
    employmentStatus: f.employmentStatus,
    phone: f.phone,
    maxLoadCredits: num(f.maxLoadCredits),
    joinedOn: f.joinedOn ? isoDate(f.joinedOn) : null,
    account: admin ? await accountSummary(f.userId) : null,
    permissions: {
      edit: covers(actor.grants, 'faculty:update', {
        departmentId: f.department.id,
        schoolId: f.department.schoolId,
      }),
      manageAccount: coversAny(actor, 'user:manage_status', f),
    },
    createdAt: f.createdAt.toISOString(),
  };
}

async function load(id: string) {
  const f = await prisma.facultyMember.findUnique({ where: { id }, include });
  if (!f) throw new NotFoundError('Faculty member');
  return f;
}

export async function getFaculty(actor: ActorContext, id: string) {
  return detailDto(actor, await load(id));
}

export async function getOwnFaculty(actor: ActorContext) {
  const f = await prisma.facultyMember.findUnique({ where: { userId: actor.userId }, include });
  if (!f) throw new NotFoundError('Faculty profile');
  return detailDto(actor, f);
}

export interface FacultyListQuery {
  page: number;
  limit: number;
  q?: string;
  departmentId?: string;
  schoolId?: string;
  designation?: string;
  employmentStatus?: string;
  sort: { field: 'lastName' | 'employeeNumber' | 'createdAt'; direction: 'asc' | 'desc' }[];
}

function facultyWhere(q: FacultyListQuery): Prisma.FacultyMemberWhereInput[] {
  return [
    q.q
      ? {
          OR: [
            { employeeNumber: { contains: q.q, mode: 'insensitive' } },
            { user: { email: { contains: q.q, mode: 'insensitive' } } },
            { user: { firstName: { contains: q.q, mode: 'insensitive' } } },
            { user: { lastName: { contains: q.q, mode: 'insensitive' } } },
          ],
        }
      : {},
    q.departmentId
      ? {
          OR: [
            { departmentId: q.departmentId },
            { secondaryDepartments: { some: { departmentId: q.departmentId } } },
          ],
        }
      : {},
    q.schoolId ? { department: { schoolId: q.schoolId } } : {},
    q.designation ? { designation: q.designation as never } : {},
    q.employmentStatus ? { employmentStatus: q.employmentStatus as never } : {},
  ];
}

const orderBy = (q: FacultyListQuery) =>
  q.sort.map((s) =>
    s.field === 'lastName' ? { user: { lastName: s.direction } } : { [s.field]: s.direction },
  );

/** Administrative list (scoped). */
export async function listFaculty(actor: ActorContext, q: FacultyListQuery) {
  const scope = departmentWhere(actor, 'faculty:read');
  const where: Prisma.FacultyMemberWhereInput = {
    AND: [
      scope
        ? { OR: [{ department: scope }, { secondaryDepartments: { some: { department: scope } } }] }
        : {},
      ...facultyWhere(q),
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.facultyMember.count({ where }),
    prisma.facultyMember.findMany({ where, include, orderBy: orderBy(q), ...paging(q) }),
  ]);
  return {
    total,
    items: rows.map((f) => ({
      id: f.id,
      employeeNumber: f.employeeNumber,
      firstName: f.user.firstName,
      lastName: f.user.lastName,
      email: f.user.email,
      designation: f.designation,
      department: f.department,
      employmentStatus: f.employmentStatus,
      accountStatus: f.user.status,
      headOf: f.headOf,
    })),
  };
}

/** Directory for every signed-in user: active faculty, public fields only. */
export async function facultyDirectory(q: FacultyListQuery) {
  const where: Prisma.FacultyMemberWhereInput = {
    AND: [{ employmentStatus: { not: 'INACTIVE' } }, ...facultyWhere(q)],
  };
  const [total, rows] = await Promise.all([
    prisma.facultyMember.count({ where }),
    prisma.facultyMember.findMany({ where, include, orderBy: orderBy(q), ...paging(q) }),
  ]);
  return { total, items: await Promise.all(rows.map(directoryDto)) };
}

async function assertDepartments(primary: string, secondary: string[]) {
  const ids = [...new Set([primary, ...secondary])];
  const depts = await prisma.department.findMany({ where: { id: { in: ids } } });
  const byId = new Map(depts.map((d) => [d.id, d]));
  const primaryDept = byId.get(primary);
  if (!primaryDept) throw invalid('departmentId', 'Unknown department');
  if (primaryDept.status !== 'ACTIVE')
    throw invalid('departmentId', 'This department is not active');
  if (secondary.includes(primary))
    throw invalid('secondaryDepartmentIds', 'The primary department cannot also be secondary');
  if (secondary.some((id) => !byId.has(id)))
    throw invalid('secondaryDepartmentIds', 'Unknown department');
  return primaryDept;
}

const employeeTaken = () =>
  new ConflictError(ErrorCode.UNIQUE_VIOLATION, 'This employee number is already used', {
    fields: [{ path: 'body.employeeNumber', message: 'Already in use' }],
  });

export async function createFaculty(
  actor: ActorContext,
  input: z.output<typeof facultyCreateSchema>,
) {
  const dept = await assertDepartments(input.departmentId, input.secondaryDepartmentIds);
  assertInScope(actor, 'faculty:create', { departmentId: dept.id, schoolId: dept.schoolId });
  if (
    input.employeeNumber &&
    (await prisma.facultyMember.findUnique({ where: { employeeNumber: input.employeeNumber } }))
  ) {
    throw employeeTaken();
  }
  const member = await prisma.$transaction(async (tx) => {
    const user = await createInvitedUser(tx, {
      ...input,
      role: 'FACULTY',
      assignedById: actor.userId,
    });
    const f = await tx.facultyMember.create({
      data: {
        userId: user.id,
        employeeNumber: input.employeeNumber ?? (await generateEmployeeNumber(tx)),
        departmentId: dept.id,
        designation: input.designation,
        employmentStatus: input.employmentStatus,
        qualifications: input.qualifications,
        specialization: input.specialization,
        researchInterests: input.researchInterests,
        officeLocation: input.officeLocation,
        officeHours: input.officeHours,
        phone: input.phone,
        maxLoadCredits: input.maxLoadCredits,
        joinedOn: input.joinedOn ? new Date(`${input.joinedOn}T00:00:00Z`) : null,
        secondaryDepartments: {
          create: input.secondaryDepartmentIds.map((departmentId) => ({ departmentId })),
        },
      },
    });
    await recordAudit(
      actor,
      {
        action: 'faculty.created',
        entityType: 'FacultyMember',
        entityId: f.id,
        changes: {
          employeeNumber: f.employeeNumber,
          departmentId: dept.id,
          userId: user.id,
          email: input.email,
        },
      },
      tx,
    );
    return f;
  });
  if (input.sendInvite) await sendInvitations([member.userId]);
  return getFaculty(actor, member.id);
}

export async function updateFaculty(
  actor: ActorContext,
  id: string,
  input: z.output<typeof facultyUpdateSchema>,
) {
  const before = await load(id);
  assertInScope(actor, 'faculty:update', {
    departmentId: before.department.id,
    schoolId: before.department.schoolId,
  });
  const primary = input.departmentId ?? before.department.id;
  const secondary =
    input.secondaryDepartmentIds ?? before.secondaryDepartments.map((s) => s.department.id);
  if (input.departmentId || input.secondaryDepartmentIds) {
    const dept = await assertDepartments(primary, secondary);
    if (dept.id !== before.department.id)
      assertInScope(actor, 'faculty:update', { departmentId: dept.id, schoolId: dept.schoolId });
  }
  if (
    input.employmentStatus === 'INACTIVE' &&
    before.employmentStatus !== 'INACTIVE' &&
    (before.headOf.length || before.deanOf.length)
  ) {
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      'This person heads a department or faculty; appoint a successor first',
      { headOf: before.headOf.map((d) => d.name), deanOf: before.deanOf.map((s) => s.name) },
    );
  }
  if (
    input.departmentId &&
    input.departmentId !== before.department.id &&
    before.headOf.some((d) => d.id === before.department.id)
  ) {
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      'Appoint a new head of department before moving this person',
    );
  }
  const { firstName, lastName, secondaryDepartmentIds, joinedOn, ...fields } = input;
  await prisma.$transaction(async (tx) => {
    if (firstName || lastName)
      await tx.user.update({ where: { id: before.userId }, data: { firstName, lastName } });
    const after = await tx.facultyMember.update({
      where: { id },
      data: {
        ...fields,
        ...(joinedOn !== undefined
          ? { joinedOn: joinedOn ? new Date(`${joinedOn}T00:00:00Z`) : null }
          : {}),
        ...(secondaryDepartmentIds
          ? {
              secondaryDepartments: {
                deleteMany: {},
                create: secondaryDepartmentIds.map((departmentId) => ({ departmentId })),
              },
            }
          : {}),
      },
    });
    const changes = diffChanges(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
    );
    for (const k of ['updatedAt', 'user', 'department', 'secondaryDepartments', 'headOf', 'deanOf'])
      delete changes[k];
    if (secondaryDepartmentIds)
      changes.secondaryDepartmentIds = {
        from: before.secondaryDepartments.map((s) => s.department.id),
        to: secondaryDepartmentIds,
      };
    if (firstName || lastName)
      changes.name = {
        from: `${before.user.firstName} ${before.user.lastName}`,
        to: `${firstName ?? before.user.firstName} ${lastName ?? before.user.lastName}`,
      };
    await recordAudit(
      actor,
      {
        action: 'faculty.updated',
        entityType: 'FacultyMember',
        entityId: id,
        changes: changes as never,
      },
      tx,
    );
  });
  return getFaculty(actor, id);
}

export async function updateOwnFaculty(
  actor: ActorContext,
  input: z.output<typeof facultySelfUpdateSchema>,
) {
  const f = await prisma.facultyMember.findUnique({ where: { userId: actor.userId } });
  if (!f) throw new NotFoundError('Faculty profile');
  await prisma.$transaction(async (tx) => {
    await tx.facultyMember.update({ where: { id: f.id }, data: input });
    await recordAudit(
      actor,
      {
        action: 'faculty.self_updated',
        entityType: 'FacultyMember',
        entityId: f.id,
        changes: { fields: Object.keys(input) },
      },
      tx,
    );
  });
  return getOwnFaculty(actor);
}
