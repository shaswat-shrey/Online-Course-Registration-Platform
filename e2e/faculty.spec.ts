import { expect, test } from '@playwright/test';
import { ACCOUNTS, expectSignedIn, navigateTo, signIn } from './support';

test.describe('faculty portal', () => {
  test('faculty sees a student on the roster and sends a section announcement (SRS journey steps 11–13)', async ({
    page,
  }, info) => {
    const title = `E2E notice ${info.project.name} ${Date.now().toString().slice(-6)}`;
    await signIn(page, ACCOUNTS.faculty);
    await expectSignedIn(page, '/faculty/dashboard');
    await expect(page.getByText('Students taught')).toBeVisible();

    // 12. The roster of one of their sections.
    await navigateTo(page, 'My teaching');
    await page.getByText('CS101 B').first().click();
    await expect(page.getByRole('heading', { name: /CS101 B/ })).toBeVisible();
    await page.getByRole('tab', { name: /Roster/ }).click();
    const firstRow = page.getByRole('table', { name: 'Class roster' }).locator('tbody tr').first();
    await expect(firstRow).toContainText(/\d{2}CS\d{4}/);
    await firstRow.click();
    await expect(page.getByText('Academic details for teaching purposes only.')).toBeVisible();
    await page.keyboard.press('Escape');

    // 13. A section announcement.
    await page.getByRole('tab', { name: 'Announcements' }).click();
    await page.getByRole('button', { name: 'New announcement' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByLabel('Message').fill('Bring your laptop to the next lab.');
    await expect(dialog.getByRole('checkbox', { name: 'CS101 B' })).toBeChecked();
    await dialog.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Announcement published')).toBeVisible();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();

    // Clean up so repeated runs do not pile up notices.
    await page.getByRole('button', { name: `Delete “${title}”` }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Announcement deleted')).toBeVisible();
  });
});
