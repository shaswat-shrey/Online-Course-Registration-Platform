import { expect, test } from '@playwright/test';

test.describe('foundation smoke test', () => {
  test('status page shows the seeded university and live service checks', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('University platform');
    await expect(page.getByText('Operational', { exact: true })).toBeVisible();
    for (const label of ['Database', 'Cache & queues', 'File storage']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test('unknown routes render the 404 page with a way home', async ({ page }) => {
    await page.goto('/definitely-not-a-page');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.getByRole('link', { name: 'Go to home' }).click();
    await expect(page).toHaveURL('/');
  });

  test('API returns the standard envelope through the dev proxy', async ({ request }) => {
    const res = await request.get('/api/v1/health/live');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, data: { status: 'ok' } });
    expect(res.headers()['x-request-id']).toBeTruthy();
  });
});
