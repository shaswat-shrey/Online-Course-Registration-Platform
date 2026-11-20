import type { z } from 'zod';
import type { degreeCreateSchema, degreeUpdateSchema } from '@ucrams/shared';
import type { ActorContext } from '../../common/context/actor.js';
import { NotFoundError } from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { diffChanges, recordAudit } from '../audit/audit.service.js';
import { assertGlobal } from '../authz/authz.js';
import { codeTaken, hasDependents } from '../structure-scope.js';

const include = { _count: { select: { programs: true } } } as const;

function toDto(d: {
  id: string;
  code: string;
  name: string;
  level: string;
  description: string | null;
  status: string;
  _count: { programs: number };
}) {
  return {
    id: d.id,
    code: d.code,
    name: d.name,
    level: d.level,
    description: d.description,
    status: d.status,
    programCount: d._count.programs,
  };
}

export async function listDegrees(q: { level?: string; status?: string }) {
  const rows = await prisma.degree.findMany({
    where: {
      ...(q.level ? { level: q.level as never } : {}),
      ...(q.status ? { status: q.status as never } : {}),
    },
    orderBy: [{ level: 'asc' }, { name: 'asc' }],
    include,
  });
  return rows.map(toDto);
}

export async function createDegree(
  actor: ActorContext,
  input: z.output<typeof degreeCreateSchema>,
) {
  assertGlobal(actor, 'degree:manage');
  if (await prisma.degree.findUnique({ where: { code: input.code } })) throw codeTaken('degree');
  return prisma.$transaction(async (tx) => {
    const d = await tx.degree.create({ data: input, include });
    await recordAudit(
      actor,
      { action: 'degree.created', entityType: 'Degree', entityId: d.id, changes: input as never },
      tx,
    );
    return toDto(d);
  });
}

export async function updateDegree(
  actor: ActorContext,
  id: string,
  input: z.output<typeof degreeUpdateSchema>,
) {
  assertGlobal(actor, 'degree:manage');
  const before = await prisma.degree.findUnique({ where: { id } });
  if (!before) throw new NotFoundError('Degree');
  if (
    input.code &&
    input.code !== before.code &&
    (await prisma.degree.findUnique({ where: { code: input.code } }))
  ) {
    throw codeTaken('degree');
  }
  if (input.status && input.status !== 'ACTIVE' && before.status === 'ACTIVE') {
    const active = await prisma.program.count({ where: { degreeId: id, status: 'ACTIVE' } });
    if (active > 0)
      throw hasDependents('Active programs award this degree; deactivate them first', {
        activePrograms: active,
      });
  }
  return prisma.$transaction(async (tx) => {
    const d = await tx.degree.update({ where: { id }, data: input, include });
    await recordAudit(
      actor,
      {
        action: 'degree.updated',
        entityType: 'Degree',
        entityId: id,
        changes: diffChanges(before, d) as never,
      },
      tx,
    );
    return toDto(d);
  });
}

export async function deleteDegree(actor: ActorContext, id: string) {
  assertGlobal(actor, 'degree:manage');
  const d = await prisma.degree.findUnique({ where: { id }, include });
  if (!d) throw new NotFoundError('Degree');
  if (d._count.programs > 0)
    throw hasDependents('Programs award this degree; deactivate it instead', {
      programs: d._count.programs,
    });
  await prisma.$transaction(async (tx) => {
    await tx.degree.delete({ where: { id } });
    await recordAudit(
      actor,
      { action: 'degree.deleted', entityType: 'Degree', entityId: id, changes: { code: d.code } },
      tx,
    );
  });
}
