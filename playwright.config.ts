import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (docs/TESTING.md §4). Requires PostgreSQL and Redis running
 * and the dev database migrated + seeded. Starts the full dev stack unless one
 * is already running on :5173.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:4000/api/v1/health/ready',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
