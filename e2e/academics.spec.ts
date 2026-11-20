import { expect, test, type Page } from '@playwright/test';
import { ACCOUNTS, expectSignedIn, navigateTo, signIn } from './support';

async function openWorkspace(page: Page, tab: string) {
  await navigateTo(page, 'My teaching');
  await page.getByText('CS101 B').first().click();
  await expect(page.getByRole('heading', { name: /CS101 B/ })).toBeVisible();
  await page.getByRole('tab', { name: tab, exact: true }).click();
}

test.describe('academic management', () => {
  test('instructor takes attendance for a class', async ({ page }, info) => {
    const topic = `E2E class ${info.project.name} ${Date.now().toString().slice(-6)}`;
    await signIn(page, ACCOUNTS.faculty);
    await expectSignedIn(page, '/faculty/dashboard');
    await openWorkspace(page, 'Attendance');

    await page.getByRole('button', { name: 'Add class' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Date').fill('2026-12-07');
    await dialog
      .getByLabel('Start time (optional)')
      .fill(`1${Date.now() % 10}:${String(Date.now() % 60).padStart(2, '0')}`);
    await dialog.getByLabel('Topic (optional)').fill(topic);
    await dialog.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText('Class added')).toBeVisible();

    const row = page.getByRole('listitem').filter({ hasText: topic });
    await row.getByRole('button', { name: 'Mark' }).click();
    const first = page.getByRole('radiogroup').first();
    await first.getByRole('radio', { name: 'Absent' }).click();
    await page.getByRole('button', { name: /Everyone else present/ }).click();
    await expect(first.getByRole('radio', { name: 'Absent' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.getByRole('button', { name: 'Save attendance' }).click();
    await expect(page.getByText('Attendance saved')).toBeVisible();
    await expect(row).toContainText(/(\d+) of \1 marked/);

    // Clean up so repeated runs do not pile up classes.
    await row.getByRole('button', { name: /Remove class/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
    await expect(row).toHaveCount(0);
  });

  test('instructor submits final grades and the department administrator returns them', async ({
    page,
    browser,
  }, info) => {
    const exam = `E2E final ${info.project.name} ${Date.now().toString().slice(-6)}`;
    await signIn(page, ACCOUNTS.faculty);
    await expectSignedIn(page, '/faculty/dashboard');
    await openWorkspace(page, 'Assessments');

    // Seeded components carry 60 %; a final exam makes 100 % so grades can be submitted.
    await page.getByRole('button', { name: 'Add assessment' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Title').fill(exam);
    await dialog.getByLabel('Weight (%)').fill('40');
    await dialog.getByLabel('Maximum score').fill('100');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Assessment saved')).toBeVisible();
    await expect(page.getByText('100%', { exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Final grades', exact: true }).click();
    await page.getByRole('button', { name: /Fill in suggested/ }).click();
    await page.getByRole('button', { name: /Submit for approval/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText('Grades submitted for approval')).toBeVisible();
    await expect(page.getByText('Awaiting approval').first()).toBeVisible();

    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await signIn(admin, ACCOUNTS.departmentAdmin);
    await expectSignedIn(admin, '/admin/dashboard');
    await navigateTo(admin, 'Final grades');
    await admin.getByRole('link', { name: /CS101 B/ }).click();
    await expect(admin.getByRole('button', { name: /Approve and post/ })).toBeVisible();
    await admin.getByRole('button', { name: 'Return' }).click();
    await admin
      .getByRole('dialog')
      .getByLabel('Reason')
      .fill('Please double-check the borderline B grades.');
    await admin.getByRole('dialog').getByRole('button', { name: 'Return' }).click();
    await expect(admin.getByText('Grades returned')).toBeVisible();
    await adminContext.close();

    await page.reload();
    await expect(page.getByText(/Returned by .*: Please double-check/)).toBeVisible();

    // Clean up the extra component so the section keeps its seeded 60 %.
    await page.getByRole('tab', { name: 'Assessments', exact: true }).click();
    await page.getByRole('button', { name: `Delete ${exam}` }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(exam)).toHaveCount(0);
  });
});
