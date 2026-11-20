import { Router } from 'express';
import { z } from 'zod';
import { paginationQuerySchema } from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { sendPaginated } from '../../common/http/response.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { paginatedEnvelope } from '../../openapi/registry.js';
import { assertGlobal } from '../authz/authz.js';

export const auditRouter = Router();

const auditEntrySchema = z
  .object({
    id: z.string(),
    action: z.string(),
    entityType: z.string(),
    entityId: z.string().nullable(),
    changes: z.unknown().nullable(),
    actor: z.object({ id: z.uuid(), name: z.string(), email: z.string() }).nullable(),
    ip: z.string().nullable(),
    requestId: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'AuditEntry' });

const query = paginationQuerySchema.extend({
  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(50).optional(),
  entityId: z.string().trim().max(64).optional(),
  actorId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

defineRoute(
  auditRouter,
  {
    method: 'get',
    path: '/audit-logs',
    summary: 'Search the audit log (newest first)',
    description: '`action` matches by prefix, e.g. `auth.` or `rbac.role_`.',
    tags: ['Audit'],
    access: { permission: 'audit:read' },
    request: { query },
    responses: {
      200: { description: 'Audit entries', schema: paginatedEnvelope(auditEntrySchema) },
    },
  },
  async (req, res) => {
    // Audit entries are not tied to a school/department yet: university-wide grant required.
    assertGlobal(getActor(req), 'audit:read');
    const q = req.valid.query;
    const where = {
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: { actor: { select: { id: true, firstName: true, lastName: true, email: true } } },
      }),
    ]);
    sendPaginated(
      res,
      rows.map((r) => ({
        id: r.id.toString(),
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        changes: r.changes ?? null,
        actor: r.actor
          ? {
              id: r.actor.id,
              name: `${r.actor.firstName} ${r.actor.lastName}`,
              email: r.actor.email,
            }
          : null,
        ip: r.ip,
        requestId: r.requestId,
        createdAt: r.createdAt.toISOString(),
      })),
      { page: q.page, limit: q.limit, total },
      'Audit log retrieved',
    );
  },
);
