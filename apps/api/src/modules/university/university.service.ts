import type { z } from 'zod';
import type {
  campusCreateSchema,
  campusUpdateSchema,
  universityUpdateSchema,
} from '@ucrams/shared';
import type { ActorContext } from '../../common/context/actor.js';
import { NotFoundError } from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { diffChanges, recordAudit } from '../audit/audit.service.js';
import { assertGlobal } from '../authz/authz.js';
import { codeTaken, hasDependents } from '../structure-scope.js';
import type { PublicUniversity } from './university.schemas.js';

const universitySelect = {
  id: true,
  name: true,
  shortName: true,
  timezone: true,
  schoolLabel: true,
  website: true,
  contactEmail: true,
  contactPhone: true,
  address: true,
  updatedAt: true,
} as const;

async function current() {
  const university = await prisma.university.findFirst({
    orderBy: { createdAt: 'asc' },
    select: universitySelect,
  });
  if (!university) throw new NotFoundError('University profile');
  return university;
}

export async function getPublicUniversity(): Promise<PublicUniversity> {
  const u = await current();
  return {
    id: u.id,
    name: u.name,
    shortName: u.shortName,
    timezone: u.timezone,
    schoolLabel: u.schoolLabel,
    website: u.website,
    contactEmail: u.contactEmail,
  };
}

export async function getUniversity() {
  const u = await current();
  return { ...u, updatedAt: u.updatedAt.toISOString() };
}

export async function updateUniversity(
  actor: ActorContext,
  input: z.output<typeof universityUpdateSchema>,
) {
  assertGlobal(actor, 'university:manage');
  const before = await current();
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.university.update({
      where: { id: before.id },
      data: input,
      select: universitySelect,
    });
    await recordAudit(
      actor,
      {
        action: 'university.updated',
        entityType: 'University',
        entityId: u.id,
        changes: diffChanges(before, u) as never,
      },
      tx,
    );
    return u;
  });
  return { ...updated, updatedAt: updated.updatedAt.toISOString() };
}

// ----- campuses --------------------------------------------------------------

const campusDto = (c: {
  id: string;
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  status: string;
  _count?: { schools: number; departments: number };
}) => ({
  id: c.id,
  code: c.code,
  name: c.name,
  address: c.address,
  city: c.city,
  status: c.status,
  schoolCount: c._count?.schools ?? 0,
  departmentCount: c._count?.departments ?? 0,
});

const withCounts = { _count: { select: { schools: true, departments: true } } } as const;

export async function listCampuses() {
  const rows = await prisma.campus.findMany({ orderBy: { name: 'asc' }, include: withCounts });
  return rows.map(campusDto);
}

export async function createCampus(
  actor: ActorContext,
  input: z.output<typeof campusCreateSchema>,
) {
  assertGlobal(actor, 'university:manage');
  if (await prisma.campus.findUnique({ where: { code: input.code } })) throw codeTaken('campus');
  return prisma.$transaction(async (tx) => {
    const c = await tx.campus.create({ data: input, include: withCounts });
    await recordAudit(
      actor,
      { action: 'campus.created', entityType: 'Campus', entityId: c.id, changes: input as never },
      tx,
    );
    return campusDto(c);
  });
}

export async function updateCampus(
  actor: ActorContext,
  id: string,
  input: z.output<typeof campusUpdateSchema>,
) {
  assertGlobal(actor, 'university:manage');
  const before = await prisma.campus.findUnique({ where: { id } });
  if (!before) throw new NotFoundError('Campus');
  if (
    input.code &&
    input.code !== before.code &&
    (await prisma.campus.findUnique({ where: { code: input.code } }))
  ) {
    throw codeTaken('campus');
  }
  return prisma.$transaction(async (tx) => {
    const c = await tx.campus.update({ where: { id }, data: input, include: withCounts });
    await recordAudit(
      actor,
      {
        action: 'campus.updated',
        entityType: 'Campus',
        entityId: id,
        changes: diffChanges(before, c) as never,
      },
      tx,
    );
    return campusDto(c);
  });
}

export async function deleteCampus(actor: ActorContext, id: string) {
  assertGlobal(actor, 'university:manage');
  const campus = await prisma.campus.findUnique({ where: { id }, include: withCounts });
  if (!campus) throw new NotFoundError('Campus');
  if (campus._count.schools + campus._count.departments > 0) {
    throw hasDependents('This campus is in use; deactivate it instead', {
      schools: campus._count.schools,
      departments: campus._count.departments,
    });
  }
  await prisma.$transaction(async (tx) => {
    await tx.campus.delete({ where: { id } });
    await recordAudit(
      actor,
      {
        action: 'campus.deleted',
        entityType: 'Campus',
        entityId: id,
        changes: { code: campus.code },
      },
      tx,
    );
  });
}
