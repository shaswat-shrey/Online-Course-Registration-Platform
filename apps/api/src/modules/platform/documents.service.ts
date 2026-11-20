import type { Prisma } from '../../generated/prisma/client.js';
import { ErrorCode, type DocumentVisibility } from '@ucrams/shared';
import type { ActorContext } from '../../common/context/actor.js';
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
} from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { storage } from '../../infrastructure/storage/index.js';
import { recordAudit } from '../audit/audit.service.js';
import { covers, hasPermission, scopeFilter } from '../authz/authz.js';

/*
 * Administrative documents (policies, forms, handbooks): uploaded by
 * administrators, read by the audience they are published to, optionally
 * limited to one department.
 */

const include = {
  file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, status: true } },
  department: { select: { id: true, code: true, name: true, schoolId: true } },
  uploadedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.AdminDocumentInclude;
type Row = Prisma.AdminDocumentGetPayload<{ include: typeof include }>;

const toDto = (d: Row, canManage: boolean) => ({
  id: d.id,
  title: d.title,
  description: d.description,
  category: d.category,
  visibility: d.visibility,
  department: d.department
    ? { id: d.department.id, code: d.department.code, name: d.department.name }
    : null,
  file: {
    name: d.file.originalName,
    mimeType: d.file.mimeType,
    sizeBytes: Number(d.file.sizeBytes),
  },
  uploadedBy: `${d.uploadedBy.firstName} ${d.uploadedBy.lastName}`,
  createdAt: d.createdAt.toISOString(),
  canManage,
});

const manages = (
  actor: ActorContext,
  d: { departmentId: string | null; department: { schoolId: string } | null },
) =>
  d.departmentId
    ? covers(actor.grants, 'document:manage', {
        departmentId: d.departmentId,
        schoolId: d.department?.schoolId,
      })
    : covers(actor.grants, 'document:manage', {});

/** What the caller may read as an audience member: visibilities and departments. */
async function audienceFilter(actor: ActorContext): Promise<Prisma.AdminDocumentWhereInput> {
  const [student, faculty] = await Promise.all([
    prisma.student.findUnique({
      where: { userId: actor.userId },
      select: { program: { select: { departmentId: true } } },
    }),
    prisma.facultyMember.findUnique({
      where: { userId: actor.userId },
      select: { departmentId: true },
    }),
  ]);
  const visibilities: DocumentVisibility[] = ['ALL_USERS'];
  const departments: string[] = [];
  if (student) {
    visibilities.push('STUDENTS');
    departments.push(student.program.departmentId);
  }
  if (faculty) {
    visibilities.push('FACULTY');
    departments.push(faculty.departmentId);
  }
  const admin =
    hasPermission(actor.grants, 'dashboard:admin') ||
    hasPermission(actor.grants, 'document:manage');
  if (admin) visibilities.push('ADMINS');
  return {
    visibility: { in: visibilities },
    // Administrators read every department's documents of their visibility.
    ...(admin ? {} : { OR: [{ departmentId: null }, { departmentId: { in: departments } }] }),
  };
}

/** Documents in the caller's `document:manage` scope (university-wide ones need a global grant). */
function manageFilter(actor: ActorContext): Prisma.AdminDocumentWhereInput {
  if (!hasPermission(actor.grants, 'document:manage')) throw new ForbiddenError();
  const scope = scopeFilter(actor.grants, 'document:manage');
  if (!scope) return {};
  return {
    OR: [
      { departmentId: { in: scope.departmentIds } },
      { department: { schoolId: { in: scope.schoolIds } } },
    ],
  };
}

export async function list(
  actor: ActorContext,
  q: { q?: string; category?: string; manage?: boolean },
) {
  const where: Prisma.AdminDocumentWhereInput = {
    AND: [
      q.manage ? manageFilter(actor) : await audienceFilter(actor),
      { file: { status: 'READY' } },
      q.category ? { category: q.category } : {},
      q.q
        ? {
            OR: [
              { title: { contains: q.q, mode: 'insensitive' } },
              { description: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {},
    ],
  };
  const rows = await prisma.adminDocument.findMany({
    where,
    include,
    orderBy: [{ category: 'asc' }, { title: 'asc' }],
    take: 500,
  });
  const categories = await prisma.adminDocument.findMany({
    where: q.manage ? manageFilter(actor) : await audienceFilter(actor),
    distinct: ['category'],
    select: { category: true },
    orderBy: { category: 'asc' },
  });
  return {
    items: rows.map((d) => toDto(d, manages(actor, d))),
    categories: categories.map((c) => c.category),
  };
}

export async function create(
  actor: ActorContext,
  input: {
    title: string;
    description: string | null;
    category: string;
    visibility: DocumentVisibility;
    departmentId: string | null;
    fileId: string;
  },
) {
  let schoolId: string | undefined;
  if (input.departmentId) {
    const dept = await prisma.department.findUnique({
      where: { id: input.departmentId },
      select: { schoolId: true },
    });
    if (!dept) throw new NotFoundError('Department');
    schoolId = dept.schoolId;
  }
  if (
    !covers(
      actor.grants,
      'document:manage',
      input.departmentId ? { departmentId: input.departmentId, schoolId } : {},
    )
  )
    throw new ForbiddenError();
  const file = await prisma.storedFile.findUnique({
    where: { id: input.fileId },
    select: { ownerId: true, context: true, status: true, document: { select: { id: true } } },
  });
  if (!file || file.ownerId !== actor.userId || file.context !== 'DOCUMENT')
    throw new NotFoundError('File');
  if (file.status !== 'READY' || file.document)
    throw new BusinessRuleError(
      ErrorCode.FILE_NOT_READY,
      'Upload the file before saving the document',
    );
  const doc = await prisma.adminDocument.create({
    data: { ...input, uploadedById: actor.userId },
    include,
  });
  await recordAudit(actor, {
    action: 'document.created',
    entityType: 'AdminDocument',
    entityId: doc.id,
    changes: {
      title: doc.title,
      visibility: doc.visibility,
      departmentId: doc.departmentId,
    } as never,
  });
  return toDto(doc, true);
}

async function findReadable(actor: ActorContext, id: string) {
  const doc = await prisma.adminDocument.findUnique({ where: { id }, include });
  if (!doc || doc.file.status !== 'READY') throw new NotFoundError('Document');
  if (manages(actor, doc)) return doc;
  const visible = await prisma.adminDocument.count({
    where: { id, AND: [await audienceFilter(actor)] },
  });
  if (!visible) throw new NotFoundError('Document');
  return doc;
}

/** A short-lived signed download link (FR-FILE-003). */
export async function link(actor: ActorContext, id: string) {
  const doc = await findReadable(actor, id);
  const file = await prisma.storedFile.findUniqueOrThrow({ where: { id: doc.fileId } });
  const url = await storage.createDownloadUrl(file.storageKey, {
    expiresInSeconds: 300,
    filename: file.originalName,
    disposition: 'attachment',
  });
  return { url, expiresInSeconds: 300 };
}

export async function remove(actor: ActorContext, id: string) {
  const doc = await prisma.adminDocument.findUnique({ where: { id }, include });
  if (!doc || !manages(actor, doc)) throw new NotFoundError('Document');
  const file = await prisma.storedFile.findUniqueOrThrow({ where: { id: doc.fileId } });
  await prisma.$transaction([
    prisma.adminDocument.delete({ where: { id } }),
    prisma.storedFile.delete({ where: { id: doc.fileId } }),
  ]);
  await storage.deleteObject(file.storageKey).catch(() => undefined);
  await recordAudit(actor, {
    action: 'document.deleted',
    entityType: 'AdminDocument',
    entityId: id,
    changes: { title: doc.title } as never,
  });
}
