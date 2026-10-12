/** Character sheets: created on the campaign page, laid out by the ruleset, linked to a token at the table. */
import { test, expect, type Page } from '@playwright/test';

const screenOf = (p: Page, x: number, y: number) => p.evaluate(([x, y]) => (window as any).__odTable.worldToScreen({ x, y }), [x, y] as const);
async function clickWorld(p: Page, x: number, y: number) { const s = await screenOf(p, x, y); await p.mouse.click(s.x, s.y); }

test('GM builds a ruleset-driven character sheet and opens it from a token', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Your name at the table').fill('Gwen');
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.getByLabel('Name').fill('Sheet Test');
  await page.getByLabel('Game system').selectOption('d20-fantasy');
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page.getByRole('heading', { name: 'Sheet Test' })).toBeVisible();

  await page.getByLabel('New character name').fill('Brakka');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const sheet = page.getByTestId('character-sheet');
  await expect(sheet.getByRole('group', { name: 'Abilities' })).toBeVisible(); // section from the d20 ruleset
  await sheet.getByLabel('Level', { exact: true }).fill('3');
  await sheet.getByLabel('STR', { exact: true }).fill('16');
  await sheet.getByLabel('Features & spells').click(); // blur saves
  await expect(sheet.getByRole('status')).toHaveText('Saved');
  await sheet.getByLabel('Features & spells').fill('Rage, darkvision');
  await sheet.getByLabel('STR', { exact: true }).click();
  await expect(sheet.getByRole('status')).toHaveText('Saved');

  await page.reload();
  await page.getByRole('button', { name: /Brakka/ }).click();
  await expect(sheet.getByLabel('Level', { exact: true })).toHaveValue('3');
  await expect(sheet.getByLabel('STR', { exact: true })).toHaveValue('16');
  await expect(sheet.getByLabel('Features & spells')).toHaveValue('Rage, darkvision');
  await sheet.getByLabel('Close sheet').click();

  await page.getByLabel('Session name').fill('S1');
  await page.getByRole('button', { name: 'New session' }).click();
  await expect(page.getByTestId('conn-status')).toContainText('Connected');
  await page.locator('[data-tool="token"]').click();
  await page.getByLabel('New token name').fill('Brakka');
  await clickWorld(page, 105, 105);
  await expect.poll(() => page.evaluate(() => Object.values((window as any).__odTable.state().tokens).length)).toBe(1);
  await page.locator('[data-tool="select"]').click();
  await clickWorld(page, 105, 105);
  await page.getByLabel('Linked character').selectOption({ label: 'Brakka' });
  await page.getByRole('button', { name: 'Open character sheet' }).click();
  await expect(page.getByTestId('character-sheet').getByLabel('STR', { exact: true })).toHaveValue('16');
  expect(errors).toEqual([]);
});
