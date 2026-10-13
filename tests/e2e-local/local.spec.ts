/**
 * Regression for "sign-in 404 on Vercel": with no Node server behind the page, the app must switch to
 * local mode and run sign-in, campaigns, sessions and the live table inside the browser.
 */
import { test, expect } from '@playwright/test';

test('static deployment: sign in, create a campaign and open a live table in local mode', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByTestId('local-mode')).toBeVisible();
  await page.getByLabel('Your name at the table').fill('Morgan');
  await page.getByRole('button', { name: 'Enter' }).click();
  await expect(page.getByRole('heading', { name: 'Your campaigns' })).toBeVisible();
  await page.getByLabel('Name').fill('Local Keep');
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page.getByRole('heading', { name: 'Local Keep' })).toBeVisible();
  await page.getByLabel('Session name').fill('Session 1');
  await page.getByRole('button', { name: 'New session' }).click();
  await expect(page.getByTestId('conn-status')).toContainText('Connected');
  // persists across a reload (PGlite in IndexedDB, session token in localStorage)
  await page.reload();
  await expect(page.getByTestId('conn-status')).toContainText('Connected');
  expect(errors).toEqual([]);
});
