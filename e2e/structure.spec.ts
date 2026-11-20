import { expect, test, type Page } from '@playwright/test';
import { ACCOUNTS, expectSignedIn, signIn } from './support';

async function choose(page: Page, label: string, option: string | RegExp) {
  await page.getByRole('dialog').getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
}

test.describe('university structure administration', () => {
  test('admin creates a department, program and specialization, then removes them (SRS journeys 1–3)', async ({
    page,
  }, info) => {
    const suffix = `${info.project.name === 'mobile' ? 'M' : 'D'}${Date.now().toString().slice(-6)}`;
    const deptName = `E2E Quantum Engineering ${suffix}`;
    await signIn(page, ACCOUNTS.superAdmin);
    await expectSignedIn(page, '/admin/dashboard');

    // 1. Department
    await page.goto('/admin/departments');
    await page.getByRole('button', { name: 'New department' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Code').fill(`QE${suffix}`);
    await dialog.getByLabel('Name').fill(deptName);
    await choose(page, 'Faculty / school', 'Faculty of Engineering');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: deptName })).toBeVisible();

    // 2. Program in that department
    await page.getByRole('button', { name: 'New program' }).click();
    await dialog.getByLabel('Code').fill(`BTECH-QE${suffix}`);
    await dialog.getByLabel('Name').fill(`B.Tech in Quantum Engineering ${suffix}`);
    await choose(page, 'Degree', /Bachelor of Technology/);
    await dialog.getByLabel('Total credits required').fill('120');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByRole('heading', { name: `B.Tech in Quantum Engineering ${suffix}` }),
    ).toBeVisible();

    // Requirement within the credit budget
    await page.getByRole('button', { name: 'Add requirement' }).click();
    await dialog.getByLabel('Name').fill('Open electives');
    await dialog.getByLabel('Minimum credits').fill('12');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('12 of 120 credits allocated')).toBeVisible();

    // 3. Specialization
    await page.getByRole('tab', { name: /Specializations/ }).click();
    await page.getByRole('button', { name: 'New specialization' }).click();
    await dialog.getByLabel('Code').fill('QCOMP');
    await dialog.getByLabel('Name').fill('Quantum Computing');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Quantum Computing', { exact: true })).toBeVisible();

    // Program with a specialization cannot be deleted; remove in reverse order.
    await page.getByRole('button', { name: 'Actions for Quantum Computing' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Quantum Computing deleted')).toBeVisible();

    await page.goto(`/admin/programs?q=QE${suffix}`);
    await page
      .getByRole('button', { name: `Actions for B.Tech in Quantum Engineering ${suffix}` })
      .click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('No matching programs')).toBeVisible();

    await page.goto(`/admin/departments?q=QE${suffix}`);
    await page.getByRole('button', { name: `Actions for ${deptName}` }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('No matching departments')).toBeVisible();
  });

  test('department admins can only edit their own department', async ({ page }) => {
    await signIn(page, ACCOUNTS.departmentAdmin);
    await expectSignedIn(page, '/admin/dashboard');
    await page.goto('/admin/departments?q=engineering');
    await expect(page.getByText('Mechanical Engineering')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Actions for Mechanical Engineering' }),
    ).toHaveCount(0);
    await page.goto('/admin/departments?q=computer');
    await expect(page.getByRole('button', { name: 'Actions for Computer Science' })).toBeVisible();
    await page.getByText('Computer Science', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
  });

  test('registration periods are shown in the university time zone', async ({ page }) => {
    await signIn(page, ACCOUNTS.registrar);
    await expectSignedIn(page, '/admin/dashboard');
    await page.goto('/admin/academic-sessions');
    await page.getByText('SPRING-2027', { exact: true }).click();
    await page.getByRole('tab', { name: 'Registration period' }).click();
    await expect(
      page.getByText('Times are in the university time zone (Asia/Kolkata).'),
    ).toBeVisible();
    await expect(page.getByLabel('Registration opens')).toHaveValue('2026-11-18T09:00');
  });
});
