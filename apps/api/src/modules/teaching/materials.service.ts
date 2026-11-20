import { ErrorCode } from '@ucrams/shared';
import type { z } from 'zod';
import type { materialCreateSchema, materialUpdateSchema } from '@ucrams/shared';
import type { ActorContext } from '../../common/context/actor.js';
import { BusinessRuleError, NotFoundError } from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { storage } from '../../infrastructure/storage/index.js';
import { recordAudit } from '../audit/audit.service.js';
import {
  assertInSection,
  canInSection,
  isSectionStudent,
  sectionAccess,
} from './teaching-access.js';

const include = {
  file: { select: { originalName: true, mimeType: true, sizeBytes: true } },
  createdBy: { select: { firstName: true, lastName: true } },
} as const;

function dto(m: {
  id: string;
  sectionId: string;
  folder: string | null;
  title: string;
  description: string | null;
  kind: string;
  url: string | null;
  position: number;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  file: { originalName: string; mimeType: string; sizeBytes: bigint } | null;
  createdBy: { firstName: string; lastName: string };
}) {
  return {
    id: m.id,
    sectionId: m.sectionId,
    folder: m.folder,
    title: m.title,
    description: m.description,
    kind: m.kind,
    url: m.kind === 'LINK' ? m.url : null,
    file: m.file
      ? {
          name: m.file.originalName,
          mimeType: m.file.mimeType,
          sizeBytes: Number(m.file.sizeBytes),
        }
      : null,
    position: m.position,
    published: m.publishedAt !== null,
    publishedAt: m.publishedAt?.toISOString() ?? null,
    createdBy: `${m.createdBy.firstName} ${m.createdBy.lastName}`,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

/**
 * Instructors and administrators see every material; registered students see
 * published ones only (FR-FACULTY-007). Anyone else gets 404.
 */
export async function listMaterials(actor: ActorContext, sectionId: string) {
  const access = await sectionAccess(actor, sectionId);
  const manager =
    canInSection(actor, access, 'material:manage') || canInSection(actor, access, 'roster:read');
  if (!manager && !(await isSectionStudent(actor, sectionId))) throw new NotFoundError('Section');
  const rows = await prisma.sectionMaterial.findMany({
    where: { sectionId, ...(manager ? {} : { publishedAt: { not: null } }) },
    include,
    orderBy: [
      { folder: { sort: 'asc', nulls: 'first' } },
      { position: 'asc' },
      { createdAt: 'asc' },
    ],
  });
  return { canManage: canInSection(actor, access, 'material:manage'), items: rows.map(dto) };
}

export async function createMaterial(
  actor: ActorContext,
  sectionId: string,
  input: z.output<typeof materialCreateSchema>,
) {
  const access = await sectionAccess(actor, sectionId);
  assertInSection(actor, access, 'material:manage');
  if (input.kind === 'FILE') {
    const file = await prisma.storedFile.findUnique({ where: { id: input.fileId! } });
    if (!file || file.ownerId !== actor.userId || file.context !== 'MATERIAL')
      throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Upload the file first', {
        fields: [{ path: 'body.fileId', message: 'Unknown upload' }],
      });
    if (file.status !== 'READY')
      throw new BusinessRuleError(ErrorCode.FILE_NOT_READY, 'The upload has not finished');
  }
  const last = await prisma.sectionMaterial.aggregate({
    where: { sectionId, folder: input.folder },
    _max: { position: true },
  });
  const m = await prisma.sectionMaterial.create({
    data: {
      sectionId,
      folder: input.folder,
      title: input.title,
      description: input.description,
      kind: input.kind,
      fileId: input.fileId,
      url: input.url,
      position: (last._max.position ?? -1) + 1,
      publishedAt: input.publish ? new Date() : null,
      createdById: actor.userId,
    },
    include,
  });
  await recordAudit(actor, {
    action: 'material.created',
    entityType: 'SectionMaterial',
    entityId: m.id,
    changes: { sectionId, title: m.title, published: input.publish },
  });
  return dto(m);
}

async function loadForManage(actor: ActorContext, id: string) {
  const m = await prisma.sectionMaterial.findUnique({ where: { id } });
  if (!m) throw new NotFoundError('Material');
  const access = await sectionAccess(actor, m.sectionId);
  assertInSection(actor, access, 'material:manage');
  return m;
}

export async function updateMaterial(
  actor: ActorContext,
  id: string,
  input: z.output<typeof materialUpdateSchema>,
) {
  const before = await loadForManage(actor, id);
  if (input.url !== undefined && before.kind !== 'LINK')
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Only links have a URL', {
      fields: [{ path: 'body.url', message: 'Not a link' }],
    });
  const { published, ...rest } = input;
  const m = await prisma.sectionMaterial.update({
    where: { id },
    data: {
      ...rest,
      ...(published === undefined
        ? {}
        : { publishedAt: published ? (before.publishedAt ?? new Date()) : null }),
    },
    include,
  });
  await recordAudit(actor, {
    action: 'material.updated',
    entityType: 'SectionMaterial',
    entityId: id,
    changes: input as never,
  });
  return dto(m);
}

/** Deletes the material and its stored file (when no other material uses it). */
export async function deleteMaterial(actor: ActorContext, id: string) {
  const m = await loadForManage(actor, id);
  await prisma.sectionMaterial.delete({ where: { id } });
  if (m.fileId && (await prisma.sectionMaterial.count({ where: { fileId: m.fileId } })) === 0) {
    const file = await prisma.storedFile.findUnique({ where: { id: m.fileId } });
    if (file) {
      await storage.deleteObject(file.storageKey);
      await prisma.storedFile.update({ where: { id: file.id }, data: { status: 'REJECTED' } });
    }
  }
  await recordAudit(actor, {
    action: 'material.deleted',
    entityType: 'SectionMaterial',
    entityId: id,
    changes: { sectionId: m.sectionId, title: m.title },
  });
}

/** Short-lived signed download after the membership check (FR-FILE-003). */
export async function materialLink(actor: ActorContext, id: string) {
  const m = await prisma.sectionMaterial.findUnique({ where: { id }, include: { file: true } });
  if (!m) throw new NotFoundError('Material');
  const access = await sectionAccess(actor, m.sectionId);
  const manager =
    canInSection(actor, access, 'material:manage') || canInSection(actor, access, 'roster:read');
  if (!manager && !(m.publishedAt && (await isSectionStudent(actor, m.sectionId))))
    throw new NotFoundError('Material');
  if (m.kind === 'LINK') return { url: m.url!, expiresInSeconds: null };
  if (!m.file || m.file.status !== 'READY')
    throw new BusinessRuleError(ErrorCode.FILE_NOT_READY, 'The file is not available');
  const url = await storage.createDownloadUrl(m.file.storageKey, {
    expiresInSeconds: 300,
    filename: m.file.originalName,
    disposition: 'attachment',
  });
  return { url, expiresInSeconds: 300 };
}
