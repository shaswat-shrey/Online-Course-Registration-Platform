import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { parse } from 'dotenv';
import { Redis } from 'ioredis';

/** Applies migrations to the test database and clears the test Redis DB once per run. */
export default async function setup() {
  const testEnv = parse(readFileSync(new URL('../../.env.test', import.meta.url)));
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, ...testEnv },
    stdio: 'pipe',
  });
  const redis = new Redis(testEnv.REDIS_URL!);
  await redis.flushdb();
  redis.disconnect();
  return async () => {
    await rm(testEnv.STORAGE_LOCAL_DIR!, { recursive: true, force: true });
  };
}
