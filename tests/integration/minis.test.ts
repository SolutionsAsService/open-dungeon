import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openDb, migrate, type Db } from '../../server/db/index';
import { Services, CommandError } from '../../server/services';
import { MemoryStorage } from '../../server/storage';
import { Hub } from '../../server/hub';
import { createApi } from '../../server/routes';
import { Command } from '../../shared/protocol';
import { binaryStl } from '../fixtures/meshes';

let db: Db; let svc: Services; let storage: MemoryStorage; let api: ReturnType<typeof createApi>;
const libMesh = Buffer.from(JSON.stringify([{ name: 'Knight', color: '#888888', vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 30]], triangles: [[0, 1, 2]] }]));
const library = { library: async () => [{ id: 'knight', name: 'Knight', family: 'Heroes', kind: 'figure' as const, category: 'npc' as const, footprintMm: 25, cells: 1, heightMm: 30, model: 'knight.parts.json', description: '' }], mesh: async (id: string) => (id === 'knight' ? libMesh : null) };

const users: Record<string, { id: string; cookie: string }> = {};
async function call(who: string, method: string, path: string, body?: unknown, raw?: Uint8Array) {
  const [p, q] = path.split('?');
  const r = await api.dispatch({ method, path: p, search: q ? '?' + q : '', headers: { cookie: users[who]?.cookie, 'x-od-client': '1' }, body: raw ?? (body === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body))) });
  return { status: r.status, json: r.json as any, binary: r.binary };
}

let cid: string, sid: string;
beforeAll(async () => {
  db = await openDb({ databaseUrl: null, dataDir: null }); await migrate(db);
  storage = new MemoryStorage();
  svc = new Services(db, storage, { maxUploadBytes: 64 * 1024, miniLibrary: library });
  api = createApi(svc, new Hub(svc));
  for (const n of ['gm', 'pl', 'pl2', 'spec', 'out']) { const r = await svc.devSignIn(n); users[n] = { id: r.user.id, cookie: 'od_session=' + r.token }; }
  cid = (await svc.createCampaign(users.gm.id, { name: 'Minis' })).id;
  sid = (await svc.createSession(users.gm.id, cid, { name: 'S1' })).id;
  for (const [n, role] of [['pl', 'player'], ['pl2', 'player'], ['spec', 'spectator']] as const) await svc.acceptInvite(users[n].id, (await svc.createInvite(users.gm.id, cid, { role })).token);
});
afterAll(async () => { await db.close(); });

describe('private library sources over the API', () => {
  it('lists the library and serves meshes to members only', async () => {
    const l = await call('pl', 'GET', '/api/campaigns/' + cid + '/minis');
    expect(l.status).toBe(200);
    expect(l.json.library.map((i: any) => i.id)).toEqual(['knight']);
    const m = await call('spec', 'GET', '/api/campaigns/' + cid + '/minis/knight/mesh');
    expect(m.status).toBe(200);
    expect(JSON.parse(Buffer.from(m.binary!).toString())[0].name).toBe('Knight');
    expect((await call('out', 'GET', '/api/campaigns/' + cid + '/minis')).status).toBe(404);
    expect((await call('out', 'GET', '/api/campaigns/' + cid + '/minis/knight/mesh')).status).toBe(404);
    expect((await call('nobody', 'GET', '/api/campaigns/' + cid + '/minis/knight/mesh')).status).toBe(401);
    expect((await call('pl', 'GET', '/api/campaigns/' + cid + '/minis/ghost/mesh')).status).toBe(404);
  });
});

describe('bring-your-own figures', () => {
  const up = (who: string, q: string, data: Uint8Array) => call(who, 'POST', '/api/campaigns/' + cid + '/minis?' + q, undefined, data);
  let gmMini: string, plMini: string;

  it('the GM uploads an STL; it is converted, stored and listed under its owner', async () => {
    const r = await up('gm', 'name=Ogre&baseMm=50', binaryStl(12.5, 32));
    expect(r.status).toBe(200);
    expect(r.json.item).toMatchObject({ name: 'Ogre', family: 'Uploaded', footprintMm: 50, cells: 2, heightMm: 32, kind: 'figure' });
    expect(r.json.conversion).toMatchObject({ format: 'stl', units: 'mm', triangles: 6 });
    gmMini = r.json.item.id;
    expect(gmMini).toMatch(/^u-[0-9a-f]{16}$/);
    const l = await call('pl', 'GET', '/api/campaigns/' + cid + '/minis');
    expect(l.json.uploaded).toEqual([expect.objectContaining({ id: gmMini, ownerName: 'gm', canEdit: false })]);
    expect(l.json).toMatchObject({ playerUploads: false, canUpload: false });
    const mesh = await call('pl', 'GET', '/api/campaigns/' + cid + '/minis/' + gmMini + '/mesh');
    expect(JSON.parse(Buffer.from(mesh.binary!).toString())[0].vertices).toHaveLength(5);
  });

  it('rejects junk, oversized files and bad options', async () => {
    expect((await up('gm', 'name=X', new TextEncoder().encode('<html>'))).status).toBe(415);
    expect((await up('gm', 'name=X', new Uint8Array(70 * 1024))).status).toBe(413);
    expect((await up('gm', 'name=', binaryStl())).status).toBe(400);
    expect((await up('gm', 'name=X&heightMm=99999', binaryStl())).status).toBe(400);
  });

  it('players upload only when the GM allows it; spectators and outsiders never', async () => {
    expect((await up('pl', 'name=Mine', binaryStl())).status).toBe(403);
    expect((await call('pl', 'PATCH', '/api/campaigns/' + cid + '/mini-settings', { playerUploads: true })).status).toBe(403);
    expect((await call('gm', 'PATCH', '/api/campaigns/' + cid + '/mini-settings', { playerUploads: true })).status).toBe(200);
    const r = await up('pl', 'name=Mine&heightMm=40', binaryStl());
    expect(r.status).toBe(200);
    expect(r.json.item.heightMm).toBe(40);
    plMini = r.json.item.id;
    expect((await up('spec', 'name=S', binaryStl())).status).toBe(403);
    expect((await up('out', 'name=O', binaryStl())).status).toBe(404);
  });

  it('players put their own uploaded figure on their own token, but not library or other uploads', async () => {
    const run = (u: string, c: unknown) => svc.applyCommand(users[u].id, sid, Command.parse(c));
    const tok = ((await run('gm', { type: 'token.create', name: 'Hero', x: 35, y: 35, ownerIds: [users.pl.id] })).effects[0] as any).tokens[0].token;
    const r = await run('pl', { type: 'token.update', id: tok.id, patch: { miniId: plMini }, baseVersion: tok.version });
    const t2 = (r.effects[0] as any).tokens[0].token;
    expect(t2.miniId).toBe(plMini);
    await expect(run('pl', { type: 'token.update', id: tok.id, patch: { miniId: gmMini }, baseVersion: t2.version })).rejects.toBeInstanceOf(CommandError);
    await expect(run('pl', { type: 'token.update', id: tok.id, patch: { miniId: 'knight' }, baseVersion: t2.version })).rejects.toBeInstanceOf(CommandError);
    await expect(run('pl', { type: 'token.update', id: tok.id, patch: { miniId: null }, baseVersion: t2.version })).rejects.toBeInstanceOf(CommandError);
    await expect(run('pl2', { type: 'token.update', id: tok.id, patch: { miniId: plMini }, baseVersion: t2.version })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('only the uploader or a GM renames and deletes; deleting removes the stored mesh', async () => {
    const path = '/api/campaigns/' + cid + '/minis/' + plMini;
    expect((await call('pl2', 'PATCH', path, { name: 'Stolen' })).status).toBe(403);
    expect((await call('pl', 'PATCH', path, { name: 'My Paladin' })).status).toBe(200);
    expect((await call('gm', 'GET', '/api/campaigns/' + cid + '/minis')).json.uploaded.find((i: any) => i.id === plMini)).toMatchObject({ name: 'My Paladin', canEdit: true });
    expect((await call('pl', 'DELETE', '/api/campaigns/' + cid + '/minis/' + gmMini)).status).toBe(403);
    expect((await call('gm', 'DELETE', path)).status).toBe(200);
    expect(await storage.get('mini_' + plMini)).toBeNull();
    expect((await call('pl', 'GET', path + '/mesh')).status).toBe(404);
    expect((await call('gm', 'DELETE', path)).status).toBe(404);
  });
});
