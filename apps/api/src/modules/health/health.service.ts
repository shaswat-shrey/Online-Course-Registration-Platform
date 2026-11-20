import type { HealthStatus } from '@ucrams/shared';
import { env } from '../../config/env.js';
import { pingDatabase } from '../../infrastructure/database/prisma.js';
import { pingRedis } from '../../infrastructure/redis/redis.js';
import { storage } from '../../infrastructure/storage/index.js';

type Check = () => Promise<void>;

const CHECK_TIMEOUT_MS = 2000;

async function runCheck(check: Check) {
  const started = performance.now();
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS)),
    ]);
    return { status: 'up' as const, latencyMs: Math.round(performance.now() - started) };
  } catch (err) {
    return { status: 'down' as const, error: err instanceof Error ? err.message : 'unknown' };
  }
}

/**
 * Readiness: database and Redis are required; storage is reported but only
 * degrades readiness (uploads fail, the rest of the API works).
 */
export async function getReadiness(): Promise<HealthStatus> {
  const [database, redisCheck, storageCheck] = await Promise.all([
    runCheck(pingDatabase),
    runCheck(pingRedis),
    runCheck(() => storage.check()),
  ]);
  const required = database.status === 'up' && redisCheck.status === 'up';
  return {
    status: !required ? 'down' : storageCheck.status === 'up' ? 'ok' : 'degraded',
    checks: { database, redis: redisCheck, storage: storageCheck },
    uptimeSeconds: Math.round(process.uptime()),
    version: env.APP_VERSION,
  };
}

export function getLiveness(): HealthStatus {
  return {
    status: 'ok',
    checks: {},
    uptimeSeconds: Math.round(process.uptime()),
    version: env.APP_VERSION,
  };
}
