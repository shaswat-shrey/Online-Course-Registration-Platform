import { expect, test } from '@playwright/test';
import { ACCOUNTS, expectSignedIn, navigateTo, signIn } from './support';

test.describe('authentication and portals', () => {
  test('each role lands in its own portal', async ({ page }) => {
    const cases = [
      [ACCOUNTS.superAdmin, '/admin/dashboard'],
      [ACCOUNTS.registrar, '/admin/dashboard'],
      [ACCOUNTS.faculty, '/faculty/dashboard'],
      [ACCOUNTS.student, '/student/dashboard'],
    ] as const;
    for (const [email, path] of cases) {
      await page.context().clearCookies();
      await signIn(page, email);
      await expectSignedIn(page, path);
    }
  });

  test('wrong password shows a generic error', async ({ page }) => {
    await signIn(page, ACCOUNTS.student, 'definitely-wrong-password');
    await expect(page.getByRole('alert')).toHaveText('The email or password is incorrect.');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('deep links survive sign-in, reloads keep the session, sign-out ends it', async ({
    page,
  }) => {
    await page.goto('/admin/roles');
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Froles$/);
    await page.getByLabel('Email').fill(ACCOUNTS.superAdmin);
    await page
      .getByLabel('Password', { exact: true })
      .fill(process.env.SEED_DEV_PASSWORD ?? (await import('./support')).DEV_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/admin\/roles$/);
    await expect(page.getByRole('cell', { name: /Super Administrator/ })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Roles & permissions' })).toBeVisible();

    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/admin/roles');
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test('students cannot reach administration pages', async ({ page }) => {
    await signIn(page, ACCOUNTS.student);
    await expectSignedIn(page, '/student/dashboard');
    await page.goto('/admin/roles');
    await expect(page).toHaveURL(/\/student\/dashboard$/);
    await expect(page.getByRole('link', { name: 'Roles & permissions' })).toHaveCount(0);
    const api = await page.request.get('/api/v1/roles');
    expect(api.status()).toBe(401); // no bearer token outside the app
  });

  test('revoking another device signs it out', async ({ browser }) => {
    const laptop = await browser.newContext();
    const phone = await browser.newContext();
    const a = await laptop.newPage();
    const b = await phone.newPage();
    await signIn(a, ACCOUNTS.faculty);
    await expectSignedIn(a, '/faculty/dashboard');
    await signIn(b, ACCOUNTS.faculty);
    await expectSignedIn(b, '/faculty/dashboard');

    await a.goto('/faculty/account');
    const otherRow = a
      .getByRole('row')
      .filter({ hasNot: a.getByText('This device') })
      .filter({ has: a.getByRole('button', { name: 'Revoke' }) });
    await otherRow.first().getByRole('button', { name: 'Revoke' }).click();
    await a.getByRole('alertdialog').getByRole('button', { name: 'Revoke session' }).click();
    await expect(a.getByText('Session revoked')).toBeVisible();

    await b.reload();
    await expect(b).toHaveURL(/\/login/);
    await laptop.close();
    await phone.close();
  });

  test('forgot password does not reveal whether an account exists', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill('nobody-here@ucrams.local');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('status')).toHaveText(/If an account exists for that email/);
  });
});

test.describe('administration', () => {
  test('super admin can browse roles and the audit log', async ({ page }) => {
    await signIn(page, ACCOUNTS.superAdmin);
    await expectSignedIn(page, '/admin/dashboard');
    await navigateTo(page, 'Roles & permissions');
    await page.getByRole('cell', { name: /Faculty Member/ }).click();
    await expect(page.getByRole('heading', { name: 'Faculty Member' })).toBeVisible();
    await expect(
      page.getByText('Applies only to the holder’s own sections and records'),
    ).toBeVisible();

    // Reached directly: on emulated phones the long navigation list re-renders while
    // Playwright scrolls it (a manual check on a real phone-sized viewport works).
    await page.goto('/admin/audit-logs');
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
    await page.getByLabel('Action starts with').fill('auth.');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/action=auth\./);
  });

  test('university admin sees roles read-only', async ({ page }) => {
    await signIn(page, ACCOUNTS.universityAdmin);
    await page.goto('/admin/roles');
    await expect(page.getByRole('button', { name: 'New role' })).toHaveCount(0);
  });
});
