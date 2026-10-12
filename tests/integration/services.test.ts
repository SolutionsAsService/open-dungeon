import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openDb, migrate, type Db } from '../../server/db/index';
import { Services, CommandError } from '../../server/services';
import { MemoryStorage } from '../../server/storage';
import { Command } from '../../shared/protocol';

let db: Db; let svc: Services;
const run = (u: string, s: string, c: unknown) => svc.applyCommand(u, s, Command.parse(c));
const png = (w: number, h: number) => { const b = Buffer.alloc(33); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };

beforeAll(async () => { db = await openDb({ databaseUrl: null, dataDir: null }); await migrate(db); svc = new Services(db, new MemoryStorage(), { maxUploadBytes: 1024 * 1024 }); });
afterAll(async () => { await db.close(); });

describe('campaign → session → table workflow', () => {
  let gm: string, player: string, outsider: string, campaignId: string, sessionId: string;
  beforeAll(async () => {
    gm = (await svc.devSignIn('Gwen GM')).user.id;
    player = (await svc.devSignIn('Pat Player')).user.id;
    outsider = (await svc.devSignIn('Olly Outsider')).user.id;
  });

  it('signs in with a token and rejects garbage tokens', async () => {
    const { token, user } = await svc.devSignIn('Tess');
    expect((await svc.userForToken(token))?.id).toBe(user.id);
    expect(await svc.userForToken('nope')).toBeNull();
    await svc.signOut(token);
    expect(await svc.userForToken(token)).toBeNull();
  });

  it('creates a campaign and a session with a default map', async () => {
    campaignId = (await svc.createCampaign(gm, { name: 'Lost Mine' })).id;
    sessionId = (await svc.createSession(gm, campaignId, { name: 'Session 1' })).id;
    const snap = await svc.snapshot(gm, sessionId);
    expect(snap.me.role).toBe('owner');
    expect(snap.map?.grid.type).toBe('square');
    expect((await svc.listCampaigns(gm))[0]).toMatchObject({ id: campaignId, sessionCount: 1 });
  });

  it('hides campaigns and sessions from non-members', async () => {
    await expect(svc.getCampaign(outsider, campaignId)).rejects.toMatchObject({ status: 404 });
    await expect(svc.snapshot(outsider, sessionId)).rejects.toMatchObject({ status: 404 });
    await expect(run(outsider, sessionId, { type: 'chat.send', body: 'hi' })).rejects.toMatchObject({ status: 404 });
  });

  it('invites a player through a single-use link', async () => {
    await expect(svc.createInvite(player, campaignId, { role: 'player' })).rejects.toMatchObject({ status: 404 });
    const inv = await svc.createInvite(gm, campaignId, { role: 'player', maxUses: 1, expiresInHours: 24 });
    expect((await svc.previewInvite(inv.token)).campaignName).toBe('Lost Mine');
    await svc.acceptInvite(player, inv.token);
    expect(await svc.roleFor(player, campaignId)).toBe('player');
    await expect(svc.acceptInvite(outsider, inv.token)).rejects.toMatchObject({ status: 404 });
    await expect(svc.acceptInvite(outsider, 'forged')).rejects.toMatchObject({ status: 404 });
  });

  let tokenId: string, tokenVersion: number;
  it('lets the GM place and assign tokens, but not players', async () => {
    await expect(run(player, sessionId, { type: 'token.create', x: 0, y: 0 })).rejects.toBeInstanceOf(CommandError);
    const r = await run(gm, sessionId, { type: 'token.create', name: 'Hero', category: 'pc', x: 35, y: 35 });
    const eff = r.effects[0] as any;
    tokenId = eff.tokens[0].token.id;
    const u = await run(gm, sessionId, { type: 'token.update', id: tokenId, baseVersion: 1, patch: { ownerIds: [player] } });
    tokenVersion = (u.effects[0] as any).tokens[0].token.version;
    expect(tokenVersion).toBe(2);
    await expect(run(gm, sessionId, { type: 'token.update', id: tokenId, baseVersion: 2, patch: { ownerIds: [outsider] } })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('lets a player move only their own token and detects stale moves', async () => {
    const r = await run(player, sessionId, { type: 'token.move', id: tokenId, x: 105, y: 35, baseVersion: tokenVersion });
    expect((r.effects[0] as any).tokens[0].token).toMatchObject({ x: 105, version: 3 });
    await expect(run(player, sessionId, { type: 'token.move', id: tokenId, x: 1, y: 1, baseVersion: tokenVersion })).rejects.toMatchObject({ code: 'stale' });
    const other = (await run(gm, sessionId, { type: 'token.create', name: 'Goblin', x: 200, y: 200 })).effects[0] as any;
    await expect(run(player, sessionId, { type: 'token.move', id: other.tokens[0].token.id, x: 1, y: 1, baseVersion: 1 })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(run(player, sessionId, { type: 'token.update', id: tokenId, baseVersion: 3, patch: { hidden: true } })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('never sends hidden or fogged tokens to players', async () => {
    const secret = (await run(gm, sessionId, { type: 'token.create', name: 'Assassin', x: 400, y: 400, hidden: true })).effects[0] as any;
    const sid = secret.tokens[0].token.id;
    let p = await svc.snapshot(player, sessionId);
    expect(p.tokens.map((t) => t.name)).not.toContain('Assassin');
    expect(JSON.stringify(p)).not.toContain(sid);
    expect((await svc.snapshot(gm, sessionId)).tokens.map((t) => t.name)).toContain('Assassin');
    await expect(run(player, sessionId, { type: 'token.move', id: sid, x: 0, y: 0, baseVersion: 1 })).rejects.toMatchObject({ code: 'not_found' });

    await expect(run(player, sessionId, { type: 'fog.reset', enabled: true })).rejects.toMatchObject({ code: 'forbidden' });
    await run(gm, sessionId, { type: 'fog.reset', enabled: true });
    p = await svc.snapshot(player, sessionId);
    expect(p.tokens.map((t) => t.name)).toEqual(['Hero']); // own token stays visible under fog; goblin is concealed
    await run(gm, sessionId, { type: 'fog.add', mode: 'reveal', shape: { kind: 'rect', x: 150, y: 150, w: 100, h: 100 } });
    p = await svc.snapshot(player, sessionId);
    expect(p.tokens.map((t) => t.name).sort()).toEqual(['Goblin', 'Hero']);
  });

  it('rolls dice server-side with visibility rules', async () => {
    const pub = await run(player, sessionId, { type: 'dice.roll', expression: '2d6+3' });
    const msg = (pub.effects[0] as any).event.message;
    expect(msg.roll.total).toBeGreaterThanOrEqual(5);
    expect(msg.roll.total).toBeLessThanOrEqual(15);
    await run(gm, sessionId, { type: 'dice.roll', expression: '1d20', visibility: 'self', label: 'secret check' });
    const ps = await svc.snapshot(player, sessionId);
    expect(ps.chat.some((c) => c.roll?.label === 'secret check')).toBe(false);
    expect((await svc.snapshot(gm, sessionId)).chat.some((c) => c.roll?.label === 'secret check')).toBe(true);
    await expect(run(player, sessionId, { type: 'dice.roll', expression: '1d20;DROP TABLE users' })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('runs initiative and hides hidden combatants from players', async () => {
    await run(gm, sessionId, { type: 'init.add', name: 'Hero', tokenId, initiative: 15 });
    await run(gm, sessionId, { type: 'init.add', name: 'Lurker', initiative: 20, hidden: true });
    await run(gm, sessionId, { type: 'init.advance', dir: 1 });
    const g = (await svc.snapshot(gm, sessionId)).initiative;
    expect(g.participants.map((x) => x.name)).toEqual(['Lurker', 'Hero']);
    expect(g.active).toBe(true);
    const p = (await svc.snapshot(player, sessionId)).initiative;
    expect(p.participants.map((x) => x.name)).toEqual(['Hero']);
    expect(p.activeId).toBeNull();
    await run(gm, sessionId, { type: 'init.advance', dir: 1 });
    expect((await svc.snapshot(player, sessionId)).initiative.activeId).toBe(p.participants[0].id);
    await run(gm, sessionId, { type: 'init.advance', dir: 1 });
    expect((await svc.snapshot(gm, sessionId)).initiative.round).toBe(2);
    await expect(run(player, sessionId, { type: 'init.advance', dir: 1 })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('keeps GM-only drawings private', async () => {
    await run(gm, sessionId, { type: 'drawing.add', gmOnly: true, shape: { kind: 'text', x: 0, y: 0, text: 'trap here', color: '#ff0000', size: 16 } });
    await expect(run(player, sessionId, { type: 'drawing.add', gmOnly: true, shape: { kind: 'text', x: 0, y: 0, text: 'x', color: '#ff0000', size: 16 } })).rejects.toMatchObject({ code: 'forbidden' });
    expect(JSON.stringify(await svc.snapshot(player, sessionId))).not.toContain('trap here');
    expect(JSON.stringify(await svc.snapshot(gm, sessionId))).toContain('trap here');
  });

  it('validates uploads by content and serves them only to members', async () => {
    await expect(svc.uploadImage(gm, campaignId, Buffer.from('<svg onload=alert(1)>'), {})).rejects.toMatchObject({ status: 415 });
    await expect(svc.uploadImage(gm, campaignId, Buffer.alloc(2 * 1024 * 1024, 1), {})).rejects.toMatchObject({ status: 413 });
    await expect(svc.uploadImage(player, campaignId, png(10, 10), {})).rejects.toMatchObject({ status: 403 });
    const a = await svc.uploadImage(gm, campaignId, png(1400, 1000), { name: 'cave.png' });
    expect(a).toMatchObject({ mime: 'image/png', width: 1400, height: 1000 });
    await svc.setMapBackground(gm, sessionId, a.id);
    expect((await svc.snapshot(player, sessionId)).map).toMatchObject({ backgroundAssetId: a.id, width: 1400, height: 1000 });
    expect((await svc.readAsset(player, a.id)).mime).toBe('image/png');
    await expect(svc.readAsset(outsider, a.id)).rejects.toMatchObject({ status: 404 });
  });

  it('closes and reopens a session with state intact', async () => {
    const before = await svc.snapshot(gm, sessionId);
    await expect(svc.setSessionStatus(player, sessionId, 'closed')).rejects.toMatchObject({ status: 403 });
    await svc.setSessionStatus(gm, sessionId, 'closed');
    await expect(run(player, sessionId, { type: 'chat.send', body: 'hello?' })).rejects.toMatchObject({ code: 'closed' });
    await svc.setSessionStatus(gm, sessionId, 'open');
    const after = await svc.snapshot(gm, sessionId);
    expect(after.tokens).toEqual(before.tokens);
    expect(after.fog).toEqual(before.fog);
    expect(after.seq).toBe(before.seq);
  });
});
