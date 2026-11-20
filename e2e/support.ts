import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { parse } from 'dotenv';
import { Redis } from 'ioredis';

const env = parse(readFileSync(new URL('../apps/api/.env', import.meta.url)));
/** Development seed password (apps/api/.env), never a production credential. */
export const DEV_PASSWORD = process.env.SEED_DEV_PASSWORD ?? env.SEED_DEV_PASSWORD ?? '';

export const ACCOUNTS = {
  superAdmin: 'superadmin@ucrams.local',
  universityAdmin: 'uniadmin@ucrams.local',
  registrar: 'registrar@ucrams.local',
  departmentAdmin: 'cs.admin@ucrams.local',
  faculty: 'faculty.cs@ucrams.local',
  student: 'student.cs@ucrams.local',
  /** A seeded first-year CS student (deterministic seed) who has not taken CS101. */
  firstYearStudent: 'imran.verma.26cs0001@students.northbridge.example.edu',
} as const;

/**
 * The suite signs in more often from one IP than the per-IP login limit allows,
 * so clear the dev API's auth rate-limit counters (rl:* keys only) before each sign-in.
 */
export async function clearRateLimits() {
  const redis = new Redis(process.env.REDIS_URL ?? env.REDIS_URL ?? 'redis://localhost:6379/0');
  try {
    const keys = await redis.keys('ucrams:rl:*');
    if (keys.length) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}

export async function signIn(page: Page, email: string, password = DEV_PASSWORD) {
  await clearRateLimits();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function expectSignedIn(page: Page, pathname: string) {
  await expect(page).toHaveURL(new RegExp(`${pathname}$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    /Good (morning|afternoon|evening)/,
  );
}

/** Clicks a sidebar link, opening the navigation sheet first on narrow screens. */
export async function navigateTo(page: Page, label: string) {
  const link = page.getByRole('link', { name: label, exact: true });
  if (!(await link.isVisible())) {
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    // The phone navigation slides in; wait for it to finish before scrolling to the item.
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect
      .poll(async () => (await sheet.boundingBox())?.x ?? -1, { timeout: 5000 })
      .toBeGreaterThanOrEqual(0);
    await link.scrollIntoViewIfNeeded();
  }
  await link.click();
}
