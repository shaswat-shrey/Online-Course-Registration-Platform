import { expect, test, type Page } from '@playwright/test';
import { ACCOUNTS, expectSignedIn, signIn } from './support';

async function pick(page: Page, label: string, search: string, option: RegExp) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('combobox', { name: `Search ${label.toLowerCase()}` }).fill(search);
  await page.getByRole('option', { name: option }).first().click();
}

test.describe('registration administration', () => {
  test('registrar registers a student with an eligibility preview; the student is notified; then drops it (SRS journeys 8, 15)', async ({
    page,
    browser,
  }) => {
    await signIn(page, ACCOUNTS.registrar);
    await expectSignedIn(page, '/admin/dashboard');
    await page.goto('/admin/registrations');
    await page.getByRole('button', { name: 'Register a student' }).click();
    const dialog = page.getByRole('dialog');
    await pick(page, 'Student', '25CS9001', /Sara Student/);
    await pick(page, 'Section', 'CS306', /CS306 A.*Spring 2027/);
    await expect(dialog.getByText('Eligible: the student will be registered.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Register', exact: true }).click();
    await expect(page.getByText(/Sara Student: registered in CS306 A/)).toBeVisible();

    // The student sees the notification in their own session.
    const studentContext = await browser.newContext();
    const student = await studentContext.newPage();
    await signIn(student, ACCOUNTS.student);
    await expectSignedIn(student, '/student/dashboard');
    await student.getByRole('button', { name: /Notifications, \d+ unread/ }).click();
    await expect(student.getByText('Registered in CS306 A').first()).toBeVisible();
    await studentContext.close();

    // Drop it again so repeated runs start clean.
    await page.goto('/admin/registrations?q=25CS9001&status=REGISTERED');
    await page.getByText('CS306 A').first().click();
    await expect(page.getByRole('heading', { name: /Sara Student · CS306 A/ })).toBeVisible();
    await page.getByRole('button', { name: 'Drop', exact: true }).click();
    await dialog.getByLabel('Reason').fill('End-to-end test clean-up');
    await dialog.getByRole('button', { name: 'Drop', exact: true }).click();
    await expect(page.getByText('Registration updated')).toBeVisible();
    await expect(page.getByText('Dropped', { exact: true }).first()).toBeVisible();
  });
});
