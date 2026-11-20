import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

const KEY_PREFIX = 'ucrams:';

function create(name: string, options: RedisOptions): Redis {
  const client = new Redis(env.REDIS_URL, { connectionName: `ucrams-${name}`, ...options });
  let lastError = '';
  client.on('error', (err: Error) => {
    // ioredis reconnects automatically; log each distinct error once to avoid floods.
    if (err.message !== lastError) {
      lastError = err.message;
      logger.warn({ redis: name, err: err.message }, 'Redis connection error');
    }
  });
  client.on('ready', () => {
    lastError = '';
  });
  return client;
}

/**
 * Cache / rate-limit client. Offline queue disabled so commands fail fast
 * while Redis is down and callers can fall back (NFR-AVAIL-002).
 */
export const redis = create('cache', {
  keyPrefix: KEY_PREFIX,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  lazyConnect: false,
});

/** BullMQ requires maxRetriesPerRequest: null and no key prefix (it uses its own). */
export function createQueueConnection(name: string): Redis {
  return create(`queue-${name}`, { maxRetriesPerRequest: null });
}

/** Separate pub/sub connections for the Socket.IO adapter. */
export function createPubSubPair(): { pub: Redis; sub: Redis } {
  return { pub: create('pub', {}), sub: create('sub', {}) };
}

export async function pingRedis(): Promise<void> {
  const reply = await redis.ping();
  if (reply !== 'PONG') throw new Error(`Unexpected PING reply: ${reply}`);
}
