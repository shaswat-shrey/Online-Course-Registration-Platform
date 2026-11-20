import { expect, test } from '@playwright/test';
import { ACCOUNTS, expectSignedIn, navigateTo, signIn } from './support';

test.describe('communication', () => {
  test('student opens a support ticket, an administrator answers, the student sees the reply (SRS journey steps 15–16)', async ({
    page,
    browser,
  }, info) => {
    const subject = `E2E ticket ${info.project.name} ${Date.now().toString().slice(-6)}`;

    // 15. The student submits a ticket.
    await signIn(page, ACCOUNTS.student);
    await expectSignedIn(page, '/student/dashboard');
    await navigateTo(page, 'Support');
    await page.getByRole('button', { name: 'New ticket' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Subject').fill(subject);
    await dialog
      .getByLabel('Description')
      .fill('My Spring 2027 timetable shows a clash that is not real.');
    await dialog.getByRole('button', { name: 'Submit ticket' }).click();
    await expect(page.getByText(/Ticket TCK-\d{4}-\d{6} created/)).toBeVisible();
    await expect(page.getByRole('heading', { name: subject })).toBeVisible();
    const ticketNumber = (await page.getByText(/^TCK-\d{4}-\d{6}$/).textContent())!;

    // 16. The department administrator finds it in the queue and replies, resolving it.
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await signIn(admin, ACCOUNTS.departmentAdmin);
    await expectSignedIn(admin, '/admin/dashboard');
    await navigateTo(admin, 'Support tickets');
    await admin.getByLabel('Search tickets').fill(ticketNumber);
    // Wait for the filtered list so the click does not race its re-render.
    await expect(admin).toHaveURL(/q=TCK/);
    await admin.getByRole('link', { name: subject }).click();
    await expect(admin.getByRole('heading', { name: subject })).toBeVisible();
    await admin.getByLabel('Reply').fill('Internal: checked the meeting overlap logic.');
    await admin.getByRole('checkbox', { name: /Internal note/ }).click();
    await admin.getByRole('button', { name: 'Add note' }).click();
    await expect(admin.getByText('Internal note', { exact: true })).toBeVisible();
    await admin.getByLabel('Reply').fill('The clash was a display issue and is fixed now.');
    await admin.getByRole('combobox', { name: 'Then set status' }).click();
    await admin.getByRole('option', { name: 'Resolved' }).click();
    await admin.getByRole('button', { name: 'Send reply' }).click();
    await expect(admin.getByText('Reply sent')).toBeVisible();
    await adminContext.close();

    // The student's open ticket updates in real time; internal notes stay hidden.
    await expect(
      page.getByRole('main').getByText('The clash was a display issue and is fixed now.'),
    ).toBeVisible();
    await expect(page.getByText(/checked the meeting overlap/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
    await page.getByRole('button', { name: /Notifications, \d+ unread/ }).click();
    await expect(page.getByText(`${ticketNumber}: Reply — ticket resolved`).first()).toBeVisible();
  });

  test('student writes to university support and the department administrator answers in the inbox', async ({
    page,
    browser,
  }, info) => {
    const question = `E2E support question ${info.project.name} ${Date.now().toString().slice(-6)}`;
    await signIn(page, ACCOUNTS.student);
    await expectSignedIn(page, '/student/dashboard');
    await page.getByRole('link', { name: 'Messages', exact: true }).first().click();
    await page.getByRole('button', { name: 'Contact support' }).click();
    await page.getByRole('dialog').getByLabel('Message').fill(question);
    await page.getByRole('dialog').getByRole('button', { name: 'Send' }).click();
    const thread = page.getByRole('region', { name: 'Conversation', exact: true });
    await expect(thread.getByText(question)).toBeVisible();

    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await signIn(admin, ACCOUNTS.departmentAdmin);
    await expectSignedIn(admin, '/admin/dashboard');
    await admin.goto('/admin/messages');
    await admin.getByRole('tab', { name: 'Support inbox' }).click();
    await admin.getByRole('button', { name: /Support: Sara Student/ }).click();
    const adminThread = admin.getByRole('region', { name: 'Conversation', exact: true });
    await expect(adminThread.getByText(question)).toBeVisible();
    const answer = `Answer to ${question}`;
    await adminThread.getByLabel('Message', { exact: true }).fill(answer);
    await adminThread.getByRole('button', { name: 'Send' }).click();
    await expect(adminThread.getByText(answer)).toBeVisible();
    await adminContext.close();

    await expect(thread.getByText(answer)).toBeVisible();
  });
});
