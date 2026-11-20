import type { z } from 'zod';
import { ErrorCode, type schoolCreateSchema, type schoolUpdateSchema } from '@ucrams/shared';
import type { ActorContext } from '../../common/context/actor.js';
import { BusinessRuleError, NotFoundError } from '../../common/exceptions/app-error.js';
import { paging, searchWhere, toOrderBy } from '../../common/http/list-query.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { diffChanges, recordAudit } from '../audit/audit.service.js';
import { assertGlobal, assertInScope } from '../authz/authz.js';
import { assertDeanCandidate, personDto, personRef } from '../structure-people.js';
import { codeTaken, hasDependents } from '../structure-scope.js';

const include = {
  campus: { select: { id: true, name: true } },
  dean: personRef,
  _count: { select: { departments: true } },
} as const;

type Row = Awaited<ReturnType<typeof findRow>>;
const findRow = (id: string) => prisma.school.findUnique({ where: { id }, include });

function toDto(s: NonNullable<Row>, programCount?: number) {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    description: s.description,
    campus: s.campus,
    contactEmail: s.contactEmail,
    contactPhone: s.contactPhone,
    website: s.website,
    dean: personDto(s.dean),
    status: s.status,
    departmentCount: s._count.departments,
    ...(programCount !== undefined ? { programCount } : {}),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export async function listSchools(q: {
  page: number;
  limit: number;
  q?: string;
  status?: string;
  sort: { field: 'name' | 'code' | 'createdAt'; direction: 'asc' | 'desc' }[];
}) {
  const where = {
    ...searchWhere(q.q, ['name', 'code']),
    ...(q.status ? { status: q.status as never } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.school.count({ where }),
    prisma.school.findMany({ where, include, orderBy: toOrderBy(q.sort), ...paging(q) }),
  ]);
  return { total, items: rows.map((r) => toDto(r)) };
}

export async function getSchool(id: string) {
  const row = await findRow(id);
  if (!row) throw new NotFoundError('Faculty/school');
  const programCount = await prisma.program.count({ where: { department: { schoolId: id } } });
  return toDto(row, programCount);
}

async function assertCampus(campusId: string | null | undefined) {
  if (campusId && !(await prisma.campus.findUnique({ where: { id: campusId } }))) {
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Unknown campus', {
      fields: [{ path: 'body.campusId', message: 'No campus exists with this id' }],
    });
  }
}

export async function createSchool(
  actor: ActorContext,
  input: z.output<typeof schoolCreateSchema>,
) {
  assertGlobal(actor, 'school:manage');
  if (await prisma.school.findUnique({ where: { code: input.code } }))
    throw codeTaken('faculty/school');
  await assertCampus(input.campusId);
  if (input.deanId) {
    throw new BusinessRuleError(
      ErrorCode.VALIDATION_ERROR,
      'Appoint a dean after adding departments and faculty',
    );
  }
  return prisma.$transaction(async (tx) => {
    const s = await tx.school.create({ data: input, include });
    await recordAudit(
      actor,
      { action: 'school.created', entityType: 'School', entityId: s.id, changes: input as never },
      tx,
    );
    return toDto(s, 0);
  });
}

export async function updateSchool(
  actor: ActorContext,
  id: string,
  input: z.output<typeof schoolUpdateSchema>,
) {
  const before = await prisma.school.findUnique({ where: { id } });
  if (!before) throw new NotFoundError('Faculty/school');
  // School admins (SCHOOL-scoped school:manage) may edit their own school; creation stays university-wide.
  assertInScope(actor, 'school:manage', { schoolId: id });
  if (
    input.code &&
    input.code !== before.code &&
    (await prisma.school.findUnique({ where: { code: input.code } }))
  ) {
    throw codeTaken('faculty/school');
  }
  await assertCampus(input.campusId);
  if (input.deanId !== undefined) await assertDeanCandidate(id, input.deanId);
  if (input.status && input.status !== 'ACTIVE' && before.status === 'ACTIVE') {
    const active = await prisma.department.count({ where: { schoolId: id, status: 'ACTIVE' } });
    if (active > 0)
      throw hasDependents('Deactivate its departments first', { activeDepartments: active });
  }
  return prisma.$transaction(async (tx) => {
    const s = await tx.school.update({ where: { id }, data: input, include });
    await recordAudit(
      actor,
      {
        action: 'school.updated',
        entityType: 'School',
        entityId: id,
        changes: diffChanges(before, s) as never,
      },
      tx,
    );
    return toDto(s);
  });
}

export async function deleteSchool(actor: ActorContext, id: string) {
  assertGlobal(actor, 'school:manage');
  const row = await findRow(id);
  if (!row) throw new NotFoundError('Faculty/school');
  if (row._count.departments > 0) {
    throw hasDependents('This faculty/school has departments; deactivate it instead', {
      departments: row._count.departments,
    });
  }
  await prisma.$transaction(async (tx) => {
    await tx.school.delete({ where: { id } });
    await recordAudit(
      actor,
      { action: 'school.deleted', entityType: 'School', entityId: id, changes: { code: row.code } },
      tx,
    );
  });
}
