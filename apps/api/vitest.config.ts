import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { defineConfig } from 'vitest/config';

const testEnv = parse(readFileSync(new URL('./.env.test', import.meta.url)));

export default defineConfig({
  test: {
    environment: 'node',
    env: testEnv,
    globalSetup: ['./src/tests/global-setup.ts'],
    include: ['src/**/*.test.ts'],
    // Integration tests share one database; run files sequentially.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
