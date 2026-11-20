import type { z } from 'zod';
import {
  ErrorCode,
  type programCreateSchema,
  type programUpdateSchema,
  type requirementGroupCreateSchema,
  type specializationCreateSchema,
  type specializationUpdateSchema,
} from '@ucrams/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext } from '../../common/context/actor.js';
import { BusinessRuleError, NotFoundError } from '../../common/exceptions/app-error.js';
import { num, paging, searchWhere, toOrderBy } from '../../common/http/list-query.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { diffChanges, recordAudit } from '../audit/audit.service.js';
import { assertInScope, covers } from '../authz/authz.js';
import { codeTaken, departmentTarget, hasDependents, programTarget } from '../structure-scope.js';

type GroupRow = {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  minCredits: Prisma.Decimal | null;
  category: string | null;
  position: number;
};
const groupDto = (g: GroupRow) => ({
  id: g.id,
  name: g.name,
  description: g.description,
  kind: g.kind,
  minCredits: num(g.minCredits),
  category: g.category,
  position: g.position,
});
const groupOrder = [{ position: 'asc' as const }, { createdAt: 'asc' as const }];

type SpecRow = {
  id: string;
  programId: string;
  code: string;
  name: string;
  description: string | null;
  additionalCredits: Prisma.Decimal | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  requirementGroups?: GroupRow[];
};
const specDto = (s: SpecRow) => ({
  id: s.id,
  programId: s.programId,
  code: s.code,
  name: s.name,
  description: s.description,
  additionalCredits: num(s.additionalCredits),
  status: s.status,
  ...(s.requirementGroups ? { requirementGroups: s.requirementGroups.map(groupDto) } : {}),
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

const listInclude = {
  degree: { select: { id: true, code: true, name: true, level: true } },
  department: { select: { id: true, code: true, name: true, schoolId: true } },
  _count: { select: { specializations: true } },
} as const;
const detailInclude = {
  ...listInclude,
  specializations: {
    orderBy: { name: 'asc' as const },
    include: { requirementGroups: { orderBy: groupOrder } },
  },
  requirementGroups: { orderBy: groupOrder },
} as const;

type ProgramRow = Prisma.ProgramGetPayload<{ include: typeof listInclude }> &
  Partial<Prisma.ProgramGetPayload<{ include: typeof detailInclude }>>;

function programDto(p: ProgramRow, actor: ActorContext) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    degree: p.degree,
    department: p.department,
    durationYears: num(p.durationYears)!,
    sessionCount: p.sessionCount,
    totalCredits: num(p.totalCredits)!,
    minCoreCredits: num(p.minCoreCredits),
    minElectiveCredits: num(p.minElectiveCredits),
    status: p.status,
    specializationCount: p._count.specializations,
    canManage: covers(actor.grants, 'program:manage', {
      departmentId: p.department.id,
      schoolId: p.department.schoolId,
    }),
    ...(p.specializations ? { specializations: p.specializations.map(specDto) } : {}),
    ...(p.requirementGroups ? { requirementGroups: p.requirementGroups.map(groupDto) } : {}),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function listPrograms(
  actor: ActorContext,
  q: {
    page: number;
    limit: number;
    q?: string;
    status?: string;
    departmentId?: string;
    schoolId?: string;
    degreeId?: string;
    level?: string;
    sort: { field: 'name' | 'code' | 'createdAt'; direction: 'asc' | 'desc' }[];
  },
) {
  const where: Prisma.ProgramWhereInput = {
    ...searchWhere(q.q, ['name', 'code']),
    ...(q.status ? { status: q.status as never } : {}),
    ...(q.departmentId ? { departmentId: q.departmentId } : {}),
    ...(q.schoolId ? { department: { schoolId: q.schoolId } } : {}),
    ...(q.degreeId ? { degreeId: q.degreeId } : {}),
    ...(q.level ? { degree: { level: q.level as never } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.program.count({ where }),
    prisma.program.findMany({
      where,
      include: listInclude,
      orderBy: toOrderBy(q.sort),
      ...paging(q),
    }),
  ]);
  return { total, items: rows.map((r) => programDto(r, actor)) };
}

export async function getProgram(actor: ActorContext, id: string) {
  const p = await prisma.program.findUnique({ where: { id }, include: detailInclude });
  if (!p) throw new NotFoundError('Program');
  return programDto(p, actor);
}

async function assertActiveParents(input: { degreeId?: string; departmentId?: string }) {
  if (input.degreeId) {
    const degree = await prisma.degree.findUnique({ where: { id: input.degreeId } });
    if (!degree || degree.status !== 'ACTIVE') {
      throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Choose an active degree', {
        fields: [
          {
            path: 'body.degreeId',
            message: degree ? 'This degree is not active' : 'Unknown degree',
          },
        ],
      });
    }
  }
  if (input.departmentId) {
    const dept = await prisma.department.findUnique({ where: { id: input.departmentId } });
    if (!dept || dept.status !== 'ACTIVE') {
      throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Choose an active department', {
        fields: [
          {
            path: 'body.departmentId',
            message: dept ? 'This department is not active' : 'Unknown department',
          },
        ],
      });
    }
  }
}

async function programGroupCredits(programId: string, excludeGroupId?: string) {
  const agg = await prisma.requirementGroup.aggregate({
    where: { programId, ...(excludeGroupId ? { id: { not: excludeGroupId } } : {}) },
    _sum: { minCredits: true },
  });
  return num(agg._sum.minCredits) ?? 0;
}

export async function createProgram(
  actor: ActorContext,
  input: z.output<typeof programCreateSchema>,
) {
  const target = await departmentTarget(input.departmentId).catch(() => {
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Unknown department', {
      fields: [{ path: 'body.departmentId', message: 'Unknown department' }],
    });
  });
  assertInScope(actor, 'program:manage', target);
  await assertActiveParents(input);
  if (await prisma.program.findUnique({ where: { code: input.code } })) throw codeTaken('program');
  return prisma.$transaction(async (tx) => {
    const p = await tx.program.create({ data: input, include: detailInclude });
    await recordAudit(
      actor,
      { action: 'program.created', entityType: 'Program', entityId: p.id, changes: input as never },
      tx,
    );
    return programDto(p, actor);
  });
}

export async function updateProgram(
  actor: ActorContext,
  id: string,
  input: z.output<typeof programUpdateSchema>,
) {
  const target = await programTarget(id);
  assertInScope(actor, 'program:manage', target);
  const before = await prisma.program.findUniqueOrThrow({ where: { id } });
  if (input.departmentId && input.departmentId !== before.departmentId) {
    assertInScope(actor, 'program:manage', await departmentTarget(input.departmentId));
  }
  await assertActiveParents({
    degreeId: input.degreeId !== before.degreeId ? input.degreeId : undefined,
    departmentId: input.departmentId !== before.departmentId ? input.departmentId : undefined,
  });
  if (
    input.code &&
    input.code !== before.code &&
    (await prisma.program.findUnique({ where: { code: input.code } }))
  ) {
    throw codeTaken('program');
  }
  const total = input.totalCredits ?? num(before.totalCredits)!;
  const core =
    input.minCoreCredits !== undefined
      ? (input.minCoreCredits ?? 0)
      : (num(before.minCoreCredits) ?? 0);
  const elective =
    input.minElectiveCredits !== undefined
      ? (input.minElectiveCredits ?? 0)
      : (num(before.minElectiveCredits) ?? 0);
  if (core + elective > total) {
    throw new BusinessRuleError(
      ErrorCode.VALIDATION_ERROR,
      'Core + elective minimums exceed total credits',
      {
        fields: [
          { path: 'body.totalCredits', message: 'Must be at least core + elective minimums' },
        ],
      },
    );
  }
  if (input.totalCredits !== undefined && (await programGroupCredits(id)) > input.totalCredits) {
    throw new BusinessRuleError(
      ErrorCode.VALIDATION_ERROR,
      'Requirement groups need more credits than this total',
      {
        fields: [{ path: 'body.totalCredits', message: 'Lower the requirement groups first' }],
      },
    );
  }
  if (input.status && input.status !== 'ACTIVE' && before.status === 'ACTIVE') {
    const active = await prisma.specialization.count({
      where: { programId: id, status: 'ACTIVE' },
    });
    if (active > 0)
      throw hasDependents('Deactivate its specializations first', {
        activeSpecializations: active,
      });
  }
  return prisma.$transaction(async (tx) => {
    const p = await tx.program.update({ where: { id }, data: input, include: detailInclude });
    await recordAudit(
      actor,
      {
        action: 'program.updated',
        entityType: 'Program',
        entityId: id,
        changes: diffChanges(before, p) as never,
      },
      tx,
    );
    return programDto(p, actor);
  });
}

export async function deleteProgram(actor: ActorContext, id: string) {
  const target = await programTarget(id);
  assertInScope(actor, 'program:manage', target);
  const p = await prisma.program.findUniqueOrThrow({
    where: { id },
    include: { _count: { select: { specializations: true, priorityWindows: true } } },
  });
  if (p._count.specializations + p._count.priorityWindows > 0) {
    throw hasDependents('This program is in use; deactivate it instead', {
      specializations: p._count.specializations,
      priorityWindows: p._count.priorityWindows,
    });
  }
  await prisma.$transaction(async (tx) => {
    await tx.program.delete({ where: { id } });
    await recordAudit(
      actor,
      { action: 'program.deleted', entityType: 'Program', entityId: id, changes: { code: p.code } },
      tx,
    );
  });
}

// ----- specializations -------------------------------------------------------

export async function listSpecializations(programId: string) {
  const rows = await prisma.specialization.findMany({
    where: { programId },
    orderBy: { name: 'asc' },
    include: { requirementGroups: { orderBy: groupOrder } },
  });
  return rows.map(specDto);
}

async function specializationScope(actor: ActorContext, programId: string) {
  const target = await programTarget(programId);
  assertInScope(actor, 'specialization:manage', target);
  return target;
}

export async function createSpecialization(
  actor: ActorContext,
  input: z.output<typeof specializationCreateSchema>,
) {
  await specializationScope(actor, input.programId);
  const program = await prisma.program.findUniqueOrThrow({ where: { id: input.programId } });
  if (program.status !== 'ACTIVE') {
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'The program is not active');
  }
  if (
    await prisma.specialization.findUnique({
      where: { programId_code: { programId: input.programId, code: input.code } },
    })
  ) {
    throw codeTaken('specialization in this program');
  }
  return prisma.$transaction(async (tx) => {
    const s = await tx.specialization.create({ data: input, include: { requirementGroups: true } });
    await recordAudit(
      actor,
      {
        action: 'specialization.created',
        entityType: 'Specialization',
        entityId: s.id,
        changes: input as never,
      },
      tx,
    );
    return specDto(s);
  });
}

export async function updateSpecialization(
  actor: ActorContext,
  id: string,
  input: z.output<typeof specializationUpdateSchema>,
) {
  const before = await prisma.specialization.findUnique({ where: { id } });
  if (!before) throw new NotFoundError('Specialization');
  await specializationScope(actor, before.programId);
  if (
    input.code &&
    input.code !== before.code &&
    (await prisma.specialization.findUnique({
      where: { programId_code: { programId: before.programId, code: input.code } },
    }))
  ) {
    throw codeTaken('specialization in this program');
  }
  return prisma.$transaction(async (tx) => {
    const s = await tx.specialization.update({
      where: { id },
      data: input,
      include: { requirementGroups: { orderBy: groupOrder } },
    });
    await recordAudit(
      actor,
      {
        action: 'specialization.updated',
        entityType: 'Specialization',
        entityId: id,
        changes: diffChanges(before, s) as never,
      },
      tx,
    );
    return specDto(s);
  });
}

export async function deleteSpecialization(actor: ActorContext, id: string) {
  const spec = await prisma.specialization.findUnique({ where: { id } });
  if (!spec) throw new NotFoundError('Specialization');
  await specializationScope(actor, spec.programId);
  await prisma.$transaction(async (tx) => {
    await tx.specialization.delete({ where: { id } });
    await recordAudit(
      actor,
      {
        action: 'specialization.deleted',
        entityType: 'Specialization',
        entityId: id,
        changes: { code: spec.code },
      },
      tx,
    );
  });
}

// ----- requirement groups ----------------------------------------------------

type GroupInput = z.output<typeof requirementGroupCreateSchema>;

async function groupOwnerScope(
  actor: ActorContext,
  owner: { programId?: string | null; specializationId?: string | null },
) {
  if (owner.programId) {
    assertInScope(actor, 'program:manage', await programTarget(owner.programId));
    return;
  }
  const spec = await prisma.specialization.findUnique({ where: { id: owner.specializationId! } });
  if (!spec) throw new NotFoundError('Specialization');
  assertInScope(actor, 'specialization:manage', await programTarget(spec.programId));
}

async function assertProgramCreditBudget(
  programId: string,
  minCredits: number | null,
  excludeGroupId?: string,
) {
  if (!minCredits) return;
  const program = await prisma.program.findUniqueOrThrow({ where: { id: programId } });
  const used = await programGroupCredits(programId, excludeGroupId);
  if (used + minCredits > num(program.totalCredits)!) {
    throw new BusinessRuleError(
      ErrorCode.VALIDATION_ERROR,
      'Requirement groups would exceed the program’s total credits',
      {
        fields: [
          {
            path: 'body.minCredits',
            message: `At most ${num(program.totalCredits)! - used} credits remain`,
          },
        ],
      },
    );
  }
}

export async function createRequirementGroup(
  actor: ActorContext,
  owner: { programId: string } | { specializationId: string },
  input: GroupInput,
) {
  await groupOwnerScope(actor, owner);
  if ('programId' in owner) await assertProgramCreditBudget(owner.programId, input.minCredits);
  return prisma.$transaction(async (tx) => {
    const position =
      input.position ??
      (await tx.requirementGroup.count({
        where:
          'programId' in owner
            ? { programId: owner.programId }
            : { specializationId: owner.specializationId },
      }));
    const g = await tx.requirementGroup.create({ data: { ...input, ...owner, position } });
    await recordAudit(
      actor,
      {
        action: 'requirement_group.created',
        entityType: 'RequirementGroup',
        entityId: g.id,
        changes: { ...input, ...owner } as never,
      },
      tx,
    );
    return groupDto(g);
  });
}

export async function updateRequirementGroup(actor: ActorContext, id: string, input: GroupInput) {
  const before = await prisma.requirementGroup.findUnique({ where: { id } });
  if (!before) throw new NotFoundError('Requirement group');
  await groupOwnerScope(actor, before);
  if (before.programId) await assertProgramCreditBudget(before.programId, input.minCredits, id);
  return prisma.$transaction(async (tx) => {
    const g = await tx.requirementGroup.update({ where: { id }, data: input });
    await recordAudit(
      actor,
      {
        action: 'requirement_group.updated',
        entityType: 'RequirementGroup',
        entityId: id,
        changes: diffChanges(before, g) as never,
      },
      tx,
    );
    return groupDto(g);
  });
}

export async function deleteRequirementGroup(actor: ActorContext, id: string) {
  const g = await prisma.requirementGroup.findUnique({ where: { id } });
  if (!g) throw new NotFoundError('Requirement group');
  await groupOwnerScope(actor, g);
  await prisma.$transaction(async (tx) => {
    await tx.requirementGroup.delete({ where: { id } });
    await recordAudit(
      actor,
      {
        action: 'requirement_group.deleted',
        entityType: 'RequirementGroup',
        entityId: id,
        changes: { name: g.name },
      },
      tx,
    );
  });
}
