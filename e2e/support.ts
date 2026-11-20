import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { parse } from 'dotenv';

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
} as const;

export async function signIn(page: Page, email: string, password = DEV_PASSWORD) {
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
  const link = page.getByRole('link', { name: label });
  if (!(await link.isVisible()))
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await link.click();
}
