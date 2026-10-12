/**
 * The brief's MVP acceptance flow, end to end, with two independent browser contexts (GM and player).
 */
import { test, expect, type Page } from '@playwright/test';
import { makePng } from './png';

const state = (p: Page) => p.evaluate(() => { const s = (window as any).__odTable.state(); return { tokens: Object.values(s.tokens) as any[], map: s.map, conn: s.conn, initiative: s.initiative, me: s.me }; });
const screenOf = (p: Page, x: number, y: number) => p.evaluate(([x, y]) => (window as any).__odTable.worldToScreen({ x, y }), [x, y] as const);
async function clickWorld(p: Page, x: number, y: number) { const s = await screenOf(p, x, y); await p.mouse.click(s.x, s.y); }
async function signIn(p: Page, name: string) { await p.getByLabel('Your name at the table').fill(name); await p.getByRole('button', { name: 'Enter' }).click(); }
async function tokenNamed(p: Page, name: string) { return (await state(p)).tokens.find((t) => t.name === name); }

test('GM and player run a session from setup to reopen', async ({ browser }) => {
  const gmCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const plCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const gm = await gmCtx.newPage();
  const pl = await plCtx.newPage();
  const errors: string[] = [];
  for (const [who, p] of [['gm', gm], ['player', pl]] as const) p.on('pageerror', (e) => errors.push(who + ': ' + e.message));

  // 1-2. GM signs in, creates a campaign and a session
  await gm.goto('/');
  await signIn(gm, 'Gwen the GM');
  await gm.getByLabel('Name').fill('Night at the Keep');
  await gm.getByLabel('Game system').selectOption('d20-fantasy');
  await gm.getByRole('button', { name: 'Create campaign' }).click();
  await expect(gm.getByRole('heading', { name: 'Night at the Keep' })).toBeVisible();
  const campaignUrl = gm.url();
  await gm.getByLabel('Session name').fill('Session 1');
  await gm.getByRole('button', { name: 'New session' }).click();
  await expect(gm.getByTestId('session-name')).toHaveText('Session 1');
  await expect(gm.getByTestId('conn-status')).toContainText('Connected');
  const sessionUrl = gm.url();

  // 3. upload a map  4. configure the grid
  await gm.getByRole('button', { name: 'Set up map' }).click();
  await gm.getByLabel('Upload map image').setInputFiles({ name: 'keep.png', mimeType: 'image/png', buffer: makePng(1050, 700) });
  await expect.poll(async () => (await state(gm)).map?.backgroundAssetId).toBeTruthy();
  expect((await state(gm)).map).toMatchObject({ width: 1050, height: 700 });
  await gm.getByRole('radio', { name: 'hex' }).click();
  await expect.poll(async () => (await state(gm)).map.grid.type).toBe('hex');
  await gm.getByRole('radio', { name: 'square' }).click();
  await gm.getByLabel('Units per cell').fill('5');
  await gm.getByLabel('Unit', { exact: true }).fill('ft');
  await expect.poll(async () => (await state(gm)).map.grid).toMatchObject({ type: 'square', unitsPerCell: 5, unit: 'ft' });
  await gm.getByLabel('Close map setup').click();

  // 5. place two miniatures
  await gm.locator('[data-tool="token"]').click();
  await gm.getByLabel('New token name').fill('Hero');
  await clickWorld(gm, 105, 105);
  await expect.poll(() => tokenNamed(gm, 'Hero')).toBeTruthy();
  await gm.getByLabel('New token name').fill('Goblin');
  await clickWorld(gm, 805, 525);
  await expect.poll(() => tokenNamed(gm, 'Goblin')).toBeTruthy();
  expect(await tokenNamed(gm, 'Hero')).toMatchObject({ x: 105, y: 105 }); // snapped to the cell centre

  // invite a player
  const gmCampaign = await gmCtx.newPage();
  await gmCampaign.goto(campaignUrl);
  await gmCampaign.getByRole('button', { name: /Create invite link/ }).click();
  const invite = await gmCampaign.getByTestId('invite-link').inputValue();
  expect(invite).toContain('/invite/');

  // 6-7. player joins and sees the shared map
  await pl.goto(invite);
  await signIn(pl, 'Pat the Player');
  await pl.getByRole('button', { name: 'Join campaign' }).click();
  await pl.getByRole('button', { name: 'Join table' }).click();
  await expect(pl.getByTestId('conn-status')).toContainText('Connected');
  await expect.poll(async () => (await state(pl)).tokens.map((t) => t.name).sort()).toEqual(['Goblin', 'Hero']);
  expect((await state(pl)).map.backgroundAssetId).toBe((await state(gm)).map.backgroundAssetId);
  const playerId = (await state(pl)).me.id;

  // assign the Hero token to the player
  await gm.locator('[data-tool="select"]').click();
  await clickWorld(gm, 105, 105);
  await expect(gm.getByTestId('inspector')).toBeVisible();
  await gm.getByLabel('Players who control this token').selectOption(playerId);
  await expect.poll(async () => (await tokenNamed(pl, 'Hero'))?.ownerIds).toContain(playerId);

  // players can't move tokens they don't own
  await pl.locator('[data-tool="select"]').click();
  const gobBefore = await tokenNamed(pl, 'Goblin');
  const g0 = await screenOf(pl, gobBefore.x, gobBefore.y);
  await pl.mouse.move(g0.x, g0.y); await pl.mouse.down(); await pl.mouse.move(g0.x + 150, g0.y, { steps: 5 }); await pl.mouse.up();

  // 8-9. player drags their token; GM sees it without refreshing
  const h0 = await screenOf(pl, 105, 105);
  const h1 = await screenOf(pl, 315, 175);
  await pl.mouse.move(h0.x, h0.y); await pl.mouse.down(); await pl.mouse.move(h1.x, h1.y, { steps: 8 }); await pl.mouse.up();
  await expect.poll(async () => { const t = await tokenNamed(gm, 'Hero'); return [t.x, t.y]; }).toEqual([315, 175]);
  expect(await tokenNamed(gm, 'Goblin')).toMatchObject({ x: gobBefore.x, y: gobBefore.y });

  // independent cameras: player zooms, GM's camera is unaffected
  const gmCam = await gm.evaluate(() => (window as any).__odTable.camera());
  await pl.getByLabel('Zoom in').click();
  expect(await gm.evaluate(() => (window as any).__odTable.camera())).toEqual(gmCam);

  // measuring is local and available to players
  await pl.locator('[data-tool="measure"]').click();
  await expect(pl.getByText(/1 cell = 5 ft/)).toBeVisible();
  const m0 = await screenOf(pl, 35, 35), m1 = await screenOf(pl, 385, 35);
  await pl.mouse.move(m0.x, m0.y); await pl.mouse.down(); await pl.mouse.move(m1.x, m1.y, { steps: 5 }); await pl.mouse.up();

  // 10. shared dice roll
  await pl.getByLabel('Chat message').fill('/r 1d20+2');
  await pl.getByLabel('Chat message').press('Enter');
  const plTotal = await pl.getByTestId('roll-total').last().textContent();
  await expect(gm.getByTestId('roll-total').last()).toHaveText(plTotal!);
  expect(Number(plTotal)).toBeGreaterThanOrEqual(3);

  // initiative
  await clickWorld(gm, 315, 175);
  await gm.getByRole('button', { name: 'Add to turns' }).click();
  await gm.getByRole('tab', { name: 'Turn order' }).click();
  await gm.getByRole('button', { name: 'Start' }).click();
  await pl.getByRole('tab', { name: 'Turn order' }).click();
  await expect(pl.getByTestId('initiative-list')).toContainText('Hero');
  await expect.poll(async () => (await state(pl)).initiative.active).toBe(true);

  // 11. GM covers the map in fog and reveals only the Hero's area
  await gm.locator('[data-tool="fog"]').click();
  await gm.getByRole('button', { name: 'Cover map in fog' }).click();
  await expect.poll(async () => (await state(pl)).map.fogEnabled).toBe(true);
  const r0 = await screenOf(gm, 210, 70), r1 = await screenOf(gm, 420, 280);
  await gm.mouse.move(r0.x, r0.y); await gm.mouse.down(); await gm.mouse.move(r1.x, r1.y, { steps: 5 }); await gm.mouse.up();

  // 12. the player cannot get the concealed Goblin by any route
  await expect.poll(async () => (await state(pl)).tokens.map((t) => t.name)).toEqual(['Hero']);
  const snap = await pl.evaluate(async (u) => (await fetch('/api/sessions/' + u.split('/').pop() + '/snapshot')).text(), sessionUrl);
  expect(snap).not.toContain('Goblin');
  expect(snap).not.toContain(gobBefore.id);
  expect((await state(gm)).tokens.map((t) => t.name).sort()).toEqual(['Goblin', 'Hero']);

  // 13. GM closes the session
  gm.once('dialog', (d) => d.accept());
  await gm.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(pl.getByTestId('session-status')).toHaveText('closed');

  // 14-15. reopen; a fresh load restores everything
  await gm.getByRole('button', { name: 'Reopen' }).click();
  await expect(gm.getByTestId('session-status')).toHaveCount(0);
  await pl.reload();
  await expect(pl.getByTestId('conn-status')).toContainText('Connected');
  await expect.poll(async () => { const t = await tokenNamed(pl, 'Hero'); return t && [t.x, t.y]; }).toEqual([315, 175]);
  const after = await state(pl);
  expect(after.map).toMatchObject({ fogEnabled: true, width: 1050, grid: { unitsPerCell: 5 } });
  expect(after.tokens.map((t) => t.name)).toEqual(['Hero']);
  expect(errors).toEqual([]);
  await gmCtx.close(); await plCtx.close();
});
