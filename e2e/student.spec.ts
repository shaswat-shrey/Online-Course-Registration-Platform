import { expect, test } from '@playwright/test';
import { ACCOUNTS, expectSignedIn, navigateTo, signIn } from './support';

test.describe('student portal', () => {
  test('student browses the catalog, registers, and sees the instructor’s announcement (SRS journey steps 8–10, 14)', async ({
    page,
    browser,
  }, info) => {
    const title = `E2E welcome ${info.project.name} ${Date.now().toString().slice(-6)}`;

    // 8–10. Student signs in, browses the catalog and registers for CS101 next session.
    await signIn(page, ACCOUNTS.firstYearStudent);
    await expectSignedIn(page, '/student/dashboard');
    await navigateTo(page, 'Course catalog');
    await expect(page.getByText('Registration open')).toBeVisible();
    await page.getByLabel('Search the catalog').fill('CS101');
    await page.getByText('Programming Fundamentals', { exact: false }).first().click();
    await expect(page.getByRole('heading', { name: /CS101/ })).toBeVisible();
    await page.getByRole('button', { name: 'Check & register' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('You can register for this section.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Register' }).click();
    await expect(page.getByText(/^Registered in CS101 [A-C]$/).first()).toBeVisible();
    const sectionLabel = (await page
      .getByText(/^Registered in CS101 [A-C]$/)
      .first()
      .textContent())!.replace('Registered in ', '');

    // The instructor announces to that section.
    const facultyContext = await browser.newContext();
    const faculty = await facultyContext.newPage();
    await signIn(faculty, ACCOUNTS.faculty);
    await expectSignedIn(faculty, '/faculty/dashboard');
    await faculty.goto('/faculty/announcements');
    await faculty.getByRole('button', { name: 'New announcement' }).click();
    const compose = faculty.getByRole('dialog');
    await compose.getByLabel('Title').fill(title);
    await compose.getByLabel('Message').fill('Welcome! The first lab is in week two.');
    await compose.getByRole('checkbox', { name: `${sectionLabel} (Spring 2027)` }).click();
    await compose.getByRole('button', { name: 'Publish' }).click();
    await expect(faculty.getByText('Announcement published')).toBeVisible();

    // 14. The student sees it.
    await navigateTo(page, 'Announcements');
    await expect(page.getByRole('heading', { name: title })).toBeVisible();

    // Clean up: delete the announcement and drop the registration.
    await faculty.getByRole('button', { name: `Delete “${title}”` }).click();
    await faculty.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(faculty.getByText('Announcement deleted')).toBeVisible();
    await facultyContext.close();
    await page.goto('/student/registrations');
    await page.getByRole('button', { name: 'Drop', exact: true }).first().click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Drop' }).click();
    await expect(page.getByText(/^Dropped CS101/).first()).toBeVisible();
  });
});
