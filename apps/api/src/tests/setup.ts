import { beforeAll } from 'vitest';
import { waitForRedis } from '../infrastructure/redis/redis.js';

// Each test file gets fresh clients; wait for Redis like the server does at boot.
beforeAll(async () => {
  if (!(await waitForRedis(10_000))) throw new Error('Redis is not reachable for tests');
});
