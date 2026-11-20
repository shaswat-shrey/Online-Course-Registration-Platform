import { expect, test } from '@playwright/test';
import { ACCOUNTS, expectSignedIn, signIn } from './support';

test.describe('people administration', () => {
  test('admin bulk-imports a student, skipping invalid rows (SRS journey 4)', async ({
    page,
  }, info) => {
    const suffix = `${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString().slice(-7)}`;
    const email = `e2e.import.${suffix}@ucrams.local`;
    await signIn(page, ACCOUNTS.superAdmin);
    await expectSignedIn(page, '/admin/dashboard');

    await page.goto('/admin/imports/new?kind=students');
    await page.getByLabel('Choose an import file').setInputFiles({
      name: `students-${suffix}.csv`,
      mimeType: 'text/csv',
      buffer: Buffer.from(
        `email,first_name,last_name,program_code,year_of_study\n${email},Esha,Import${suffix},BTECH-CS,1\nnot-an-email,Bad,Row,BTECH-CS,1\n`,
      ),
    });
    await page.getByRole('button', { name: 'Check file' }).click();

    await expect(page.getByText('Waiting for confirmation')).toBeVisible();
    await expect(page.getByText('Enter a valid email')).toBeVisible();
    await page.getByLabel('Email invitations when done').click();
    await page.getByRole('button', { name: 'Create 1 account(s)' }).click();
    await expect(page.getByText(/1 account\(s\) created/)).toBeVisible({ timeout: 20_000 });

    await page.goto(`/admin/students?q=${encodeURIComponent(email)}`);
    await page.getByText(`Esha Import${suffix}`).click();
    await expect(page.getByRole('heading', { name: `Esha Import${suffix}` })).toBeVisible();
    await expect(
      page.getByText('B.Tech in Computer Science', { exact: false }).first(),
    ).toBeVisible();
  });

  test('department administrator sees only their department and cannot create departments', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.departmentAdmin);
    await expectSignedIn(page, '/admin/dashboard');

    await page.goto('/admin/students');
    // Wait for real rows (not loading skeletons) before reading the table.
    await expect(page.getByRole('table').locator('tbody tr').first()).toContainText(/\d{2}CS\d{4}/);
    // Student numbers embed the department code (YY + CS + sequence), so every row is a CS student.
    const rowTexts = await page.getByRole('table').locator('tbody tr').allInnerTexts();
    expect(rowTexts.length).toBeGreaterThan(0);
    for (const text of rowTexts) expect(text).toMatch(/\b\d{2}CS\d{4}\b/);

    await page.goto('/admin/departments');
    await expect(page.getByText('Computer Science').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'New department' })).toHaveCount(0);
  });

  test('student views their record and updates contact details', async ({ page }) => {
    await signIn(page, ACCOUNTS.student);
    await expectSignedIn(page, '/student/dashboard');

    await page.goto('/student/profile');
    await expect(page.getByText('25CS9001')).toBeVisible();
    const phone = `+91 9${Date.now().toString().slice(-9)}`;
    await page.getByLabel('Phone', { exact: true }).fill(phone);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Profile saved')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Phone', { exact: true })).toHaveValue(phone);
  });
});
