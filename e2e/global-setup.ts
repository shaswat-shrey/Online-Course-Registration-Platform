import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { Redis } from 'ioredis';

/**
 * E2E runs sign in many times from one IP; clear the dev API's auth rate-limit
 * counters first so repeated local runs don't hit 429s. Touches only rl:* keys.
 */
export default async function globalSetup() {
  const env = parse(readFileSync(new URL('../apps/api/.env', import.meta.url)));
  const redis = new Redis(process.env.REDIS_URL ?? env.REDIS_URL ?? 'redis://localhost:6379/0');
  const keys = await redis.keys('ucrams:rl:*');
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
}
