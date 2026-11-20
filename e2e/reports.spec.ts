import { expect, test } from '@playwright/test';
import { ACCOUNTS, expectSignedIn, navigateTo, signIn } from './support';

test.describe('analytics and reporting', () => {
  test('administrator reads the dashboard, runs a report and exports it', async ({ page }) => {
    await signIn(page, ACCOUNTS.universityAdmin);
    await expectSignedIn(page, '/admin/dashboard');
    await expect(page.getByText('Active students')).toBeVisible();
    await expect(page.getByText('Enrollment by session').first()).toBeVisible();

    await navigateTo(page, 'Reports');
    await page.getByRole('link', { name: /Section enrollment/ }).click();
    await expect(page.getByRole('heading', { name: 'Section enrollment' })).toBeVisible();
    await expect(page.getByText(/\d+ rows/)).toBeVisible();
    await expect(page.getByRole('table', { name: 'Section enrollment' })).toContainText(
      /\d+(\.\d)?%/,
    );

    await page.getByRole('button', { name: 'CSV' }).click();
    await expect(page.getByText(/\d+ rows exported/)).toBeVisible();
    await page.goto('/admin/reports/exports');
    await expect(page.getByRole('table', { name: 'Exports' })).toContainText('Section enrollment');
  });
});
