import type { z } from 'zod';
import {
  ErrorCode,
  type departmentCreateSchema,
  type departmentUpdateSchema,
} from '@ucrams/shared';
import type { ActorContext } from '../../common/context/actor.js';
import { BusinessRuleError, NotFoundError } from '../../common/exceptions/app-error.js';
import { paging, searchWhere, toOrderBy } from '../../common/http/list-query.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { diffChanges, recordAudit } from '../audit/audit.service.js';
import { assertInScope, covers } from '../authz/authz.js';
import { codeTaken, hasDependents } from '../structure-scope.js';
import { assertHeadCandidate, personDto, personRef } from '../structure-people.js';

const include = {
  school: { select: { id: true, code: true, name: true } },
  campus: { select: { id: true, name: true } },
  head: personRef,
  _count: { select: { programs: true, facultyMembers: true } },
} as const;
const findRow = (id: string) => prisma.department.findUnique({ where: { id }, include });

function toDto(
  d: NonNullable<Awaited<ReturnType<typeof findRow>>>,
  extra: Record<string, unknown> = {},
) {
  return {
    id: d.id,
    code: d.code,
    name: d.name,
    description: d.description,
    school: d.school,
    campus: d.campus,
    contactEmail: d.contactEmail,
    contactPhone: d.contactPhone,
    officeLocation: d.officeLocation,
    head: personDto(d.head),
    status: d.status,
    programCount: d._count.programs,
    facultyCount: d._count.facultyMembers,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    ...extra,
  };
}

export async function listDepartments(
  actor: ActorContext,
  q: {
    page: number;
    limit: number;
    q?: string;
    status?: string;
    schoolId?: string;
    manageable?: boolean;
    sort: { field: 'name' | 'code' | 'createdAt'; direction: 'asc' | 'desc' }[];
  },
) {
  const where = {
    ...searchWhere(q.q, ['name', 'code']),
    ...(q.status ? { status: q.status as never } : {}),
    ...(q.schoolId ? { schoolId: q.schoolId } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.department.count({ where }),
    prisma.department.findMany({ where, include, orderBy: toOrderBy(q.sort), ...paging(q) }),
  ]);
  return {
    total,
    items: rows.map((r) =>
      toDto(r, {
        canManage: covers(actor.grants, 'department:manage', {
          departmentId: r.id,
          schoolId: r.schoolId,
        }),
      }),
    ),
  };
}

export async function getDepartment(actor: ActorContext, id: string) {
  const row = await findRow(id);
  if (!row) throw new NotFoundError('Department');
  const [specializationCount, studentCount] = await Promise.all([
    prisma.specialization.count({ where: { program: { departmentId: id } } }),
    prisma.student.count({ where: { program: { departmentId: id }, status: 'ACTIVE' } }),
  ]);
  return toDto(row, {
    specializationCount,
    studentCount,
    canManage: covers(actor.grants, 'department:manage', {
      departmentId: id,
      schoolId: row.schoolId,
    }),
  });
}

async function assertActiveSchool(schoolId: string) {
  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) {
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Unknown faculty/school', {
      fields: [{ path: 'body.schoolId', message: 'No faculty/school exists with this id' }],
    });
  }
  if (school.status !== 'ACTIVE') {
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'The faculty/school is not active', {
      fields: [{ path: 'body.schoolId', message: 'Choose an active faculty/school' }],
    });
  }
}

/**
 * Creating needs a grant covering the parent school (SCHOOL or GLOBAL scope);
 * a department-scoped administrator can edit but not create departments.
 */
export async function createDepartment(
  actor: ActorContext,
  input: z.output<typeof departmentCreateSchema>,
) {
  assertInScope(actor, 'department:manage', { schoolId: input.schoolId });
  await assertActiveSchool(input.schoolId);
  if (await prisma.department.findUnique({ where: { code: input.code } }))
    throw codeTaken('department');
  // A new department has no faculty yet, so it cannot have a head.
  if (input.headId) {
    throw new BusinessRuleError(
      ErrorCode.VALIDATION_ERROR,
      'Appoint a head after adding faculty to the department',
    );
  }
  return prisma.$transaction(async (tx) => {
    const d = await tx.department.create({ data: input, include });
    await recordAudit(
      actor,
      {
        action: 'department.created',
        entityType: 'Department',
        entityId: d.id,
        changes: input as never,
      },
      tx,
    );
    return toDto(d, { canManage: true });
  });
}

export async function updateDepartment(
  actor: ActorContext,
  id: string,
  input: z.output<typeof departmentUpdateSchema>,
) {
  const before = await prisma.department.findUnique({ where: { id } });
  if (!before) throw new NotFoundError('Department');
  assertInScope(actor, 'department:manage', { departmentId: id, schoolId: before.schoolId });
  if (input.schoolId && input.schoolId !== before.schoolId) {
    // Moving between schools needs authority over the destination too.
    assertInScope(actor, 'department:manage', { schoolId: input.schoolId });
    await assertActiveSchool(input.schoolId);
  }
  if (
    input.code &&
    input.code !== before.code &&
    (await prisma.department.findUnique({ where: { code: input.code } }))
  ) {
    throw codeTaken('department');
  }
  if (input.headId !== undefined) await assertHeadCandidate(id, input.headId);
  if (input.status && input.status !== 'ACTIVE' && before.status === 'ACTIVE') {
    const active = await prisma.program.count({ where: { departmentId: id, status: 'ACTIVE' } });
    if (active > 0)
      throw hasDependents('Deactivate its programs first', { activePrograms: active });
  }
  return prisma.$transaction(async (tx) => {
    const d = await tx.department.update({ where: { id }, data: input, include });
    await recordAudit(
      actor,
      {
        action: 'department.updated',
        entityType: 'Department',
        entityId: id,
        changes: diffChanges(before, d) as never,
      },
      tx,
    );
    return toDto(d, { canManage: true });
  });
}

export async function deleteDepartment(actor: ActorContext, id: string) {
  const row = await findRow(id);
  if (!row) throw new NotFoundError('Department');
  assertInScope(actor, 'department:manage', { schoolId: row.schoolId });
  if (row._count.programs > 0) {
    throw hasDependents('This department has programs; deactivate it instead', {
      programs: row._count.programs,
    });
  }
  const roleAssignments = await prisma.userRole.count({
    where: { scopeType: 'DEPARTMENT', scopeId: id },
  });
  if (roleAssignments > 0) {
    throw hasDependents('Role assignments are scoped to this department; remove them first', {
      roleAssignments,
    });
  }
  await prisma.$transaction(async (tx) => {
    await tx.department.delete({ where: { id } });
    await recordAudit(
      actor,
      {
        action: 'department.deleted',
        entityType: 'Department',
        entityId: id,
        changes: { code: row.code },
      },
      tx,
    );
  });
}
