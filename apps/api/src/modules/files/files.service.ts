import { randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { ErrorCode, FILE_LIMITS, type UploadIntentInput } from '@ucrams/shared';
import type { ActorContext } from '../../common/context/actor.js';
import {
  AppError,
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
} from '../../common/exceptions/app-error.js';
import { hasPermission } from '../authz/authz.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { storage } from '../../infrastructure/storage/index.js';
import { recordAudit } from '../audit/audit.service.js';

const SNIFF_BYTES = 4100;
/** Avatar links are embedded in API responses, so they live longer than download links. */
const AVATAR_URL_TTL_SECONDS = 60 * 60;

const notAllowed = (message: string) => new AppError(422, ErrorCode.FILE_TYPE_NOT_ALLOWED, message);

/**
 * Step 1 of an upload (FR-FILE-001): checks the declared type and size against
 * the context's allow-list, records a PENDING file and returns a presigned PUT.
 * Object keys are random; client file names are metadata only.
 */
export async function createUploadIntent(actor: ActorContext, input: UploadIntentInput) {
  // Course materials are only uploaded by people who may manage them somewhere.
  if (input.context === 'MATERIAL' && !hasPermission(actor.grants, 'material:manage'))
    throw new ForbiddenError();
  if (input.context === 'MESSAGE' && !hasPermission(actor.grants, 'message:send'))
    throw new ForbiddenError();
  if (
    input.context === 'TICKET' &&
    !hasPermission(actor.grants, 'ticket:submit') &&
    !hasPermission(actor.grants, 'ticket:manage')
  )
    throw new ForbiddenError();
  const limits = FILE_LIMITS[input.context];
  if (!(limits.mimeTypes as readonly string[]).includes(input.mimeType)) {
    throw notAllowed(`Allowed types: ${limits.mimeTypes.join(', ')}`);
  }
  if (input.sizeBytes > limits.maxBytes) {
    throw new AppError(
      422,
      ErrorCode.FILE_TOO_LARGE,
      `Files must be at most ${Math.round(limits.maxBytes / 1024 / 1024)} MB`,
    );
  }
  const key = `${input.context.toLowerCase()}/${actor.userId}/${randomUUID()}`;
  const file = await prisma.storedFile.create({
    data: {
      ownerId: actor.userId,
      storageKey: key,
      originalName: input.fileName.slice(0, 255),
      mimeType: input.mimeType,
      sizeBytes: BigInt(input.sizeBytes),
      context: input.context,
    },
  });
  const upload = await storage.createUploadUrl(key, {
    contentType: input.mimeType,
    maxBytes: limits.maxBytes,
  });
  return { fileId: file.id, upload };
}

/**
 * Step 2: verifies the stored object (size, magic bytes) and marks it READY, or
 * REJECTED (object deleted) when the content is not what was declared.
 */
export async function completeUpload(actor: ActorContext, fileId: string) {
  const file = await prisma.storedFile.findUnique({ where: { id: fileId } });
  if (!file || file.ownerId !== actor.userId) throw new NotFoundError('File');
  if (file.status === 'READY') return { fileId, status: file.status, mimeType: file.mimeType };
  if (file.status !== 'PENDING')
    throw new BusinessRuleError(ErrorCode.FILE_NOT_READY, 'This upload was rejected');
  const limits = FILE_LIMITS[file.context as keyof typeof FILE_LIMITS];
  const info = await storage.headObject(file.storageKey);
  if (!info)
    throw new BusinessRuleError(ErrorCode.FILE_NOT_READY, 'The file has not been uploaded yet');

  const reject = async (error: AppError) => {
    await storage.deleteObject(file.storageKey);
    await prisma.storedFile.update({ where: { id: fileId }, data: { status: 'REJECTED' } });
    throw error;
  };
  if (!limits || info.size > limits.maxBytes)
    return reject(new AppError(422, ErrorCode.FILE_TOO_LARGE, 'The file is too large'));
  const sniffed = await fileTypeFromBuffer(
    await storage.getObjectHead(file.storageKey, SNIFF_BYTES),
  );
  if (!sniffed || !(limits.mimeTypes as readonly string[]).includes(sniffed.mime)) {
    return reject(notAllowed('The file content does not match an allowed type'));
  }
  await prisma.storedFile.update({
    where: { id: fileId },
    data: {
      status: 'READY',
      mimeType: sniffed.mime,
      sizeBytes: BigInt(info.size),
      completedAt: new Date(),
    },
  });
  return { fileId, status: 'READY' as const, mimeType: sniffed.mime };
}

export async function avatarUrl(fileId: string | null | undefined): Promise<string | null> {
  if (!fileId) return null;
  const file = await prisma.storedFile.findUnique({
    where: { id: fileId },
    select: { storageKey: true, status: true },
  });
  if (!file || file.status !== 'READY') return null;
  return storage.createDownloadUrl(file.storageKey, {
    expiresInSeconds: AVATAR_URL_TTL_SECONDS,
    disposition: 'inline',
  });
}

/** Sets the caller's profile photo to one of their completed AVATAR uploads. */
export async function setOwnAvatar(actor: ActorContext, fileId: string) {
  const file = await prisma.storedFile.findUnique({ where: { id: fileId } });
  if (!file || file.ownerId !== actor.userId || file.context !== 'AVATAR')
    throw new NotFoundError('File');
  if (file.status !== 'READY')
    throw new BusinessRuleError(ErrorCode.FILE_NOT_READY, 'Finish the upload first');
  const previous = await prisma.user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: { avatarFileId: true },
  });
  await prisma.user.update({ where: { id: actor.userId }, data: { avatarFileId: fileId } });
  if (previous.avatarFileId && previous.avatarFileId !== fileId)
    await deleteFile(previous.avatarFileId);
  await recordAudit(actor, {
    action: 'user.avatar_changed',
    entityType: 'User',
    entityId: actor.userId,
  });
  return { avatarUrl: await avatarUrl(fileId) };
}

export async function removeOwnAvatar(actor: ActorContext) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: { avatarFileId: true },
  });
  if (!user.avatarFileId) return;
  await prisma.user.update({ where: { id: actor.userId }, data: { avatarFileId: null } });
  await deleteFile(user.avatarFileId);
  await recordAudit(actor, {
    action: 'user.avatar_removed',
    entityType: 'User',
    entityId: actor.userId,
  });
}

async function deleteFile(fileId: string) {
  const file = await prisma.storedFile.findUnique({ where: { id: fileId } });
  if (!file) return;
  await storage.deleteObject(file.storageKey).catch(() => undefined);
  await prisma.storedFile.delete({ where: { id: fileId } });
}

/** Maintenance: removes uploads never completed within 24 hours. */
export async function purgeStalePendingFiles(): Promise<number> {
  const stale = await prisma.storedFile.findMany({
    where: {
      status: { in: ['PENDING', 'REJECTED'] },
      createdAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) },
    },
    take: 500,
  });
  for (const f of stale) await deleteFile(f.id);
  return stale.length;
}
