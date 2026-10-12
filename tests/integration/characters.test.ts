import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openDb, migrate, type Db } from '../../server/db/index';
import { Services } from '../../server/services';
import { MemoryStorage } from '../../server/storage';
import { Command } from '../../shared/protocol';

let db: Db; let svc: Services;
let gm: string, player: string, other: string, spectator: string, outsider: string, campaignId: string, sessionId: string;
const run = (u: string, s: string, c: unknown) => svc.applyCommand(u, s, Command.parse(c));

beforeAll(async () => {
  db = await openDb({ databaseUrl: null, dataDir: null }); await migrate(db);
  svc = new Services(db, new MemoryStorage(), { maxUploadBytes: 1 << 20 });
  [gm, player, other, spectator, outsider] = await Promise.all(['GM', 'Pat', 'Olive', 'Spec', 'Out'].map(async (n) => (await svc.devSignIn(n)).user.id));
  campaignId = (await svc.createCampaign(gm, { name: 'Sheets', rulesetId: 'd20-fantasy' })).id;
  sessionId = (await svc.createSession(gm, campaignId, { name: 'S1' })).id;
  for (const [u, role] of [[player, 'player'], [other, 'player'], [spectator, 'spectator']] as const) {
    const inv = await svc.createInvite(gm, campaignId, { role });
    await svc.acceptInvite(u, inv.token);
  }
});
afterAll(async () => { await db.close(); });

describe('characters', () => {
  let heroId: string;
  it('players create their own characters with ruleset-validated sheets', async () => {
    const c = await svc.characters.create(player, campaignId, { name: 'Brakka', data: { level: 1, str: 16 } });
    heroId = c.id;
    expect(c).toMatchObject({ ownerId: player, ownerName: 'Pat', rulesetId: 'd20-fantasy', sheetSchemaVersion: 1, data: { level: 1, str: 16 }, version: 1 });
    await expect(svc.characters.create(player, campaignId, { name: 'Sneaky', ownerId: other })).rejects.toMatchObject({ status: 403 });
    await expect(svc.characters.create(spectator, campaignId, { name: 'Nope' })).rejects.toMatchObject({ status: 403 });
    await expect(svc.characters.create(outsider, campaignId, { name: 'Nope' })).rejects.toMatchObject({ status: 404 });
    await expect(svc.characters.create(player, campaignId, { name: 'Bad', data: { stress: 3 } })).rejects.toMatchObject({ status: 400 });
  });

  it('GMs create NPCs and assign characters to members only', async () => {
    const npc = await svc.characters.create(gm, campaignId, { name: 'Mayor', data: { features: 'secretly a dragon' } });
    expect(npc.ownerId).toBeNull();
    await expect(svc.characters.create(gm, campaignId, { name: 'X', ownerId: outsider })).rejects.toMatchObject({ status: 400 });
    const assigned = await svc.characters.create(gm, campaignId, { name: 'Olive PC', ownerId: other });
    expect(assigned.ownerId).toBe(other);
  });

  it('lists only what each role may see', async () => {
    expect((await svc.characters.list(gm, campaignId)).map((c) => c.name)).toEqual(['Brakka', 'Mayor', 'Olive PC']);
    expect((await svc.characters.list(player, campaignId)).map((c) => c.name)).toEqual(['Brakka']);
    expect(await svc.characters.list(spectator, campaignId)).toEqual([]);
    await expect(svc.characters.list(outsider, campaignId)).rejects.toMatchObject({ status: 404 });
    await expect(svc.characters.get(other, heroId)).rejects.toMatchObject({ status: 404 });
  });

  it('owners and GMs edit sheets with version checks; only GMs transfer', async () => {
    const u = await svc.characters.update(player, heroId, { baseVersion: 1, data: { level: 2, str: null, features: 'Rage' } });
    expect(u).toMatchObject({ version: 2, data: { level: 2, features: 'Rage' } });
    expect(u.data).not.toHaveProperty('str');
    await expect(svc.characters.update(player, heroId, { baseVersion: 1, name: 'Stale' })).rejects.toMatchObject({ status: 409 });
    await expect(svc.characters.update(other, heroId, { baseVersion: 2, name: 'Hijack' })).rejects.toMatchObject({ status: 404 });
    await expect(svc.characters.update(player, heroId, { baseVersion: 2, ownerId: other })).rejects.toMatchObject({ status: 403 });
    const t = await svc.characters.update(gm, heroId, { baseVersion: 2, ownerId: other });
    expect(t.ownerId).toBe(other);
    expect((await svc.characters.list(other, campaignId)).map((c) => c.name)).toContain('Brakka');
    await expect(svc.characters.get(player, heroId)).rejects.toMatchObject({ status: 404 });
  });

  it('links tokens to characters (GM only, same campaign)', async () => {
    const tok = ((await run(gm, sessionId, { type: 'token.create', name: 'Brakka', x: 35, y: 35, ownerIds: [other] })).effects[0] as any).tokens[0].token;
    expect(tok.characterId).toBeNull();
    await expect(run(other, sessionId, { type: 'token.update', id: tok.id, baseVersion: 1, patch: { characterId: heroId } })).rejects.toMatchObject({ code: 'forbidden' });
    const foreign = await svc.characters.create(outsider, (await svc.createCampaign(outsider, { name: 'Elsewhere' })).id, { name: 'Alien' });
    await expect(run(gm, sessionId, { type: 'token.update', id: tok.id, baseVersion: 1, patch: { characterId: foreign.id } })).rejects.toMatchObject({ code: 'invalid' });
    await run(gm, sessionId, { type: 'token.update', id: tok.id, baseVersion: 1, patch: { characterId: heroId } });
    expect((await svc.snapshot(other, sessionId)).tokens.find((t) => t.id === tok.id)?.characterId).toBe(heroId);
  });

  it('deletes: owner or GM only', async () => {
    const c = await svc.characters.create(player, campaignId, { name: 'Temp' });
    await expect(svc.characters.remove(other, c.id)).rejects.toMatchObject({ status: 404 });
    await svc.characters.remove(player, c.id);
    await expect(svc.characters.get(gm, c.id)).rejects.toMatchObject({ status: 404 });
  });
});
