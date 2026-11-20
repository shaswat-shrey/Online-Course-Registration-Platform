import type { z } from 'zod';
import { ErrorCode, type gradingScaleSchema } from '@ucrams/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext } from '../../common/context/actor.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../common/exceptions/app-error.js';
import { num } from '../../common/http/list-query.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import { assertGlobal } from '../authz/authz.js';
import { hasDependents } from '../structure-scope.js';

const include = {
  entries: { orderBy: { position: 'asc' as const } },
  _count: { select: { sessions: true } },
} as const;
type Row = Prisma.GradingScaleGetPayload<{ include: typeof include }>;

function toDto(s: Row) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    status: s.status,
    sessionCount: s._count.sessions,
    hasGradePoints: s.entries.every((e) => e.gradePoints !== null),
    entries: s.entries.map((e) => ({
      letter: e.letter,
      minPercent: num(e.minPercent)!,
      gradePoints: num(e.gradePoints),
      isPassing: e.isPassing,
      countsInGpa: e.countsInGpa,
    })),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** Entries sorted from the highest band down; position follows that order. */
function entryRows(input: z.output<typeof gradingScaleSchema>) {
  return [...input.entries]
    .sort((a, b) => b.minPercent - a.minPercent)
    .map((e, position) => ({ ...e, letter: e.letter.toUpperCase(), position }));
}

export async function listScales() {
  return (await prisma.gradingScale.findMany({ orderBy: { name: 'asc' }, include })).map(toDto);
}

export async function getScale(id: string) {
  const s = await prisma.gradingScale.findUnique({ where: { id }, include });
  if (!s) throw new NotFoundError('Grading scale');
  return toDto(s);
}

const nameTaken = () =>
  new ConflictError(ErrorCode.UNIQUE_VIOLATION, 'A grading scale with this name already exists', {
    fields: [{ path: 'body.name', message: 'Already in use' }],
  });

export async function createScale(actor: ActorContext, input: z.output<typeof gradingScaleSchema>) {
  assertGlobal(actor, 'grading_scale:manage');
  if (await prisma.gradingScale.findUnique({ where: { name: input.name } })) throw nameTaken();
  return prisma.$transaction(async (tx) => {
    const s = await tx.gradingScale.create({
      data: {
        name: input.name,
        description: input.description,
        status: input.status,
        entries: { create: entryRows(input) },
      },
      include,
    });
    await recordAudit(
      actor,
      {
        action: 'grading_scale.created',
        entityType: 'GradingScale',
        entityId: s.id,
        changes: input as never,
      },
      tx,
    );
    return toDto(s);
  });
}

/**
 * Replaces a scale. Grade bands are frozen once a completed or archived session
 * uses the scale, because posted grades were computed with them.
 */
export async function replaceScale(
  actor: ActorContext,
  id: string,
  input: z.output<typeof gradingScaleSchema>,
) {
  assertGlobal(actor, 'grading_scale:manage');
  const before = await prisma.gradingScale.findUnique({ where: { id }, include });
  if (!before) throw new NotFoundError('Grading scale');
  if (
    input.name !== before.name &&
    (await prisma.gradingScale.findUnique({ where: { name: input.name } }))
  )
    throw nameTaken();
  const finished = await prisma.academicSession.count({
    where: { gradingScaleId: id, status: { in: ['COMPLETED', 'ARCHIVED'] } },
  });
  const newEntries = entryRows(input);
  const entriesChanged =
    JSON.stringify(toDto(before).entries) !==
    JSON.stringify(
      newEntries.map(({ letter, minPercent, gradePoints, isPassing, countsInGpa }) => ({
        letter,
        minPercent,
        gradePoints,
        isPassing,
        countsInGpa,
      })),
    );
  if (finished > 0 && entriesChanged) {
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      'Grade bands are locked because completed sessions use this scale; create a new scale instead',
      { completedSessions: finished },
    );
  }
  return prisma.$transaction(async (tx) => {
    if (entriesChanged) {
      await tx.gradeScaleEntry.deleteMany({ where: { scaleId: id } });
      await tx.gradeScaleEntry.createMany({ data: newEntries.map((e) => ({ ...e, scaleId: id })) });
    }
    const s = await tx.gradingScale.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        ...(input.status ? { status: input.status } : {}),
      },
      include,
    });
    await recordAudit(
      actor,
      {
        action: 'grading_scale.updated',
        entityType: 'GradingScale',
        entityId: id,
        changes: { name: { from: before.name, to: s.name }, entriesChanged } as never,
      },
      tx,
    );
    return toDto(s);
  });
}

export async function deleteScale(actor: ActorContext, id: string) {
  assertGlobal(actor, 'grading_scale:manage');
  const s = await prisma.gradingScale.findUnique({ where: { id }, include });
  if (!s) throw new NotFoundError('Grading scale');
  if (s._count.sessions > 0)
    throw hasDependents('Sessions use this scale; deactivate it instead', {
      sessions: s._count.sessions,
    });
  await prisma.$transaction(async (tx) => {
    await tx.gradingScale.delete({ where: { id } });
    await recordAudit(
      actor,
      {
        action: 'grading_scale.deleted',
        entityType: 'GradingScale',
        entityId: id,
        changes: { name: s.name },
      },
      tx,
    );
  });
}
