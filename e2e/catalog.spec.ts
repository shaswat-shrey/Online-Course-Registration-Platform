import { expect, test, type Page } from '@playwright/test';
import { ACCOUNTS, expectSignedIn, signIn } from './support';

async function pick(page: Page, label: string, search: string, option: RegExp) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('combobox', { name: `Search ${label.toLowerCase()}` }).fill(search);
  await page.getByRole('option', { name: option }).first().click();
}

test.describe('course catalog and sections', () => {
  test('registrar creates a course, schedules a section and publishes it (SRS journeys 4–6)', async ({
    page,
  }, info) => {
    const suffix = `${info.project.name === 'mobile' ? 'M' : 'D'}${Date.now().toString().slice(-5)}`;
    const code = `QC${suffix}`;
    await signIn(page, ACCOUNTS.registrar);
    await expectSignedIn(page, '/admin/dashboard');

    // 1. Course (starts as a draft), then activate it.
    await page.goto('/admin/courses');
    await page.getByRole('button', { name: 'New course' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Code').fill(code);
    await dialog.getByLabel('Title').fill(`Quantum Circuits ${suffix}`);
    await dialog.getByRole('combobox', { name: 'Department' }).click();
    await page.getByRole('option', { name: /Computer Science \(CS\)/ }).click();
    await dialog.getByRole('button', { name: 'Create course' }).click();
    await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible();
    await expect(page.getByText('Draft', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Activate' }).click();
    await expect(page.getByText('Course activated')).toBeVisible();

    // 2. Section in the active session with a meeting and a primary instructor.
    await page.getByRole('tab', { name: /Sections/ }).click();
    await page.getByRole('button', { name: 'New section' }).click();
    await dialog.getByRole('button', { name: 'Create section' }).click();
    await expect(page.getByRole('heading', { name: new RegExp(`${code} A`) })).toBeVisible();
    await expect(page.getByText(/Assign a primary instructor before publishing/)).toBeVisible();

    await page.getByRole('button', { name: 'Edit meetings' }).click();
    await dialog.getByRole('button', { name: 'Add meeting' }).click();
    await dialog.getByLabel('Meeting 1 start').fill('19:00');
    await dialog.getByLabel('Meeting 1 end').fill('20:30');
    await dialog.getByRole('button', { name: 'Save meetings' }).click();
    await expect(page.getByText('Meetings saved')).toBeVisible();

    await page.getByRole('button', { name: 'Assign' }).click();
    await dialog.getByRole('button', { name: 'Add instructor' }).click();
    await pick(page, 'Instructor 1', 'Farhan', /Farhan Faculty/);
    await dialog.getByRole('button', { name: 'Save instructors' }).click();
    // A previous interrupted run may still hold this slot; the override path is part of the flow.
    const saved = page.getByText(/Instructors saved/);
    const conflict = dialog.getByText('Scheduling conflicts');
    await expect(saved.or(conflict)).toBeVisible();
    if (await conflict.isVisible()) {
      await dialog
        .getByLabel('Reason for overriding')
        .fill('Evening slot shared with a test section');
      await dialog.getByRole('button', { name: 'Assign anyway' }).click();
      await expect(saved).toBeVisible();
    }

    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Section published')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();

    // 3. Cancel it again (needs a reason) so repeated runs leave no open sections.
    await page.getByRole('button', { name: 'Cancel section' }).click();
    await dialog.getByLabel('Reason').fill('End-to-end test clean-up');
    await dialog.getByRole('button', { name: 'Cancel section' }).click();
    await expect(page.getByText(/Cancelled .*End-to-end test clean-up/)).toBeVisible();

    // 4. Archive the course (allowed once no section is open).
    await page.getByRole('link', { name: 'View course' }).click();
    await page.getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByText('Course archived')).toBeVisible();
  });

  test('department administrator edits only their own department’s courses', async ({ page }) => {
    await signIn(page, ACCOUNTS.departmentAdmin);
    await expectSignedIn(page, '/admin/dashboard');

    await page.goto('/admin/courses?q=MATH101');
    await page.getByText('Calculus I').first().click();
    await expect(page.getByRole('heading', { name: /MATH101/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);

    await page.goto('/admin/courses?q=CS101');
    await page.getByText('Programming Fundamentals').first().click();
    await expect(page.getByRole('heading', { name: /CS101/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  });
});
