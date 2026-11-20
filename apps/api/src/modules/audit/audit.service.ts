import type { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext, RequestMeta } from '../../common/context/actor.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../infrastructure/database/prisma.js';

type Tx = Pick<typeof prisma, 'auditLog'>;

const SENSITIVE = /password|token|secret|hash/i;

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  changes?: Prisma.InputJsonValue;
}

/** Changed fields only, with sensitive values redacted (FR-AUDIT-002). */
export function diffChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const result: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const from = before[key];
    const to = after[key];
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    result[key] = SENSITIVE.test(key) ? { from: '[REDACTED]', to: '[REDACTED]' } : { from, to };
  }
  return result;
}

/**
 * Appends an audit entry. Pass a transaction client to make the entry part of
 * the same commit as the change it describes.
 */
export async function recordAudit(
  who: ActorContext | (RequestMeta & { userId?: string | null }),
  entry: AuditEntry,
  tx: Tx = prisma,
): Promise<void> {
  try {
    await tx.auditLog.create({
      data: {
        actorId: 'userId' in who ? (who.userId ?? null) : null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        changes: entry.changes,
        ip: who.ip,
        userAgent: who.userAgent,
        requestId: who.requestId,
      },
    });
  } catch (err) {
    // Inside a transaction the error must propagate so the change rolls back with it.
    if (tx !== prisma) throw err;
    logger.error({ err, action: entry.action }, 'Failed to write audit log');
  }
}
