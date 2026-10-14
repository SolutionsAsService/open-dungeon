import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import type { AddressInfo } from 'node:net';
import { openDb, migrate, type Db } from '../../server/db/index';
import { Services } from '../../server/services';
import { MemoryStorage } from '../../server/storage';
import { createApp } from '../../server/app';
import type { ServerMessage, SessionSnapshot } from '../../shared/protocol';

let db: Db; let base: string; let close: () => void;

class Client {
  msgs: ServerMessage[] = [];
  ws!: WebSocket;
  constructor(public cookie: string) {}
  async api(method: string, path: string, body?: unknown) {
    const r = await fetch(base + path, { method, headers: { cookie: this.cookie, 'content-type': 'application/json', 'x-od-client': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw Object.assign(new Error(j.error), { status: r.status });
    return j;
  }
  connect(sessionId: string) {
    this.msgs = [];
    this.ws = new WebSocket(base.replace('http', 'ws') + '/ws?session=' + sessionId, { headers: { cookie: this.cookie } });
    this.ws.on('message', (d) => this.msgs.push(JSON.parse(d.toString())));
    const failed = new Promise<never>((_, rej) => this.ws.once('error', rej));
    return Promise.race([failed, this.waitFor((m) => m.type === 'snapshot').then((m: any) => m.snapshot as SessionSnapshot)]);
  }
  send(cid: string, cmd: unknown) { this.ws.send(JSON.stringify({ cid, cmd })); }
  async waitFor(pred: (m: any) => boolean, ms = 4000): Promise<any> {
    const start = Date.now();
    for (;;) {
      const i = this.msgs.findIndex(pred);
      if (i >= 0) return this.msgs.splice(i, 1)[0];
      if (Date.now() - start > ms) throw new Error('timeout waiting; have ' + JSON.stringify(this.msgs.map((m) => m.type)));
      await new Promise((r) => setTimeout(r, 15));
    }
  }
  ack(cid: string) { return this.waitFor((m) => m.type === 'ack' && m.cid === cid); }
}
async function signIn(name: string) {
  const r = await fetch(base + '/api/auth/dev', { method: 'POST', headers: { 'content-type': 'application/json', 'x-od-client': '1' }, body: JSON.stringify({ displayName: name }) });
  return new Client(r.headers.get('set-cookie')!.split(';')[0]);
}

beforeAll(async () => {
  db = await openDb({ databaseUrl: null, dataDir: null }); await migrate(db);
  const { server } = createApp(new Services(db, new MemoryStorage(), { maxUploadBytes: 1 << 20 }));
  await new Promise<void>((r) => server.listen(0, r));
  base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  close = () => server.close();
});
afterAll(async () => { close(); await db.close(); });

describe('realtime multiplayer', () => {
  let gm: Client, pl: Client, sessionId: string;
  beforeAll(async () => {
    gm = await signIn('GM'); pl = await signIn('Player');
    const { id: campaignId } = await gm.api('POST', '/api/campaigns', { name: 'Realtime' });
    sessionId = (await gm.api('POST', '/api/campaigns/' + campaignId + '/sessions', { name: 'S1' })).id;
    const inv = await gm.api('POST', '/api/campaigns/' + campaignId + '/invites', { role: 'player' });
    await pl.api('POST', '/api/invites/' + inv.path.split('/').pop() + '/accept');
  });

  it('rejects unauthenticated and cross-site requests', async () => {
    expect((await fetch(base + '/api/campaigns')).status).toBe(401);
    expect((await fetch(base + '/api/campaigns', { method: 'POST', headers: { cookie: gm.cookie }, body: '{}' })).status).toBe(403);
    const outsider = await signIn('Out');
    await expect(outsider.connect(sessionId)).rejects.toThrow();
  });

  it('syncs token creation and permitted moves between clients', async () => {
    await gm.connect(sessionId);
    const ps = await pl.connect(sessionId);
    expect(ps.me.role).toBe('player');
    gm.send('c1', { type: 'token.create', name: 'Hero', x: 35, y: 35, ownerIds: [ps.me.id] });
    expect((await gm.ack('c1')).ok).toBe(true);
    const seen = await pl.waitFor((m) => m.type === 'event' && m.event.type === 'token.upsert');
    const tok = seen.event.token;
    expect(tok.name).toBe('Hero');
    pl.send('m1', { type: 'token.move', id: tok.id, x: 175, y: 105, baseVersion: tok.version });
    expect((await pl.ack('m1')).ok).toBe(true);
    const moved = await gm.waitFor((m) => m.type === 'event' && m.event.type === 'token.upsert' && m.event.token.x === 175);
    expect(moved.event.token.version).toBe(tok.version + 1);
  });

  it('3D minis: tokens carry miniId and facing; owners move and turn them; only the GM swaps the model', async () => {
    const plId = (await pl.api('GET', '/api/sessions/' + sessionId + '/snapshot')).me.id;
    gm.send('mi1', { type: 'token.create', name: 'Wanderer', x: 35, y: 105, miniId: 'hooded-wanderer', ownerIds: [plId] });
    const t = (await pl.waitFor((m) => m.type === 'event' && m.event.type === 'token.upsert' && m.event.token.name === 'Wanderer')).event.token;
    expect(t).toMatchObject({ miniId: 'hooded-wanderer', locked: false, rotation: 0 });
    pl.send('mi2', { type: 'token.update', id: t.id, patch: { rotation: 90 }, baseVersion: t.version });
    expect((await pl.ack('mi2')).ok).toBe(true);
    const turned = (await gm.waitFor((m) => m.type === 'event' && m.event.type === 'token.upsert' && m.event.token.id === t.id && m.event.token.rotation === 90)).event.token;
    expect(turned.miniId).toBe('hooded-wanderer');
    pl.send('mi3', { type: 'token.update', id: t.id, patch: { miniId: 'wizard-tower' }, baseVersion: turned.version });
    expect((await pl.ack('mi3')).code).toBe('forbidden');
    gm.send('mi4', { type: 'token.create', name: 'Bad', x: 35, y: 35, miniId: '../etc/passwd' });
    expect((await gm.ack('mi4')).code).toBe('invalid');
    gm.send('mi5', { type: 'token.create', name: 'Well', x: 140, y: 140, size: 2, category: 'object', miniId: 'village-well', locked: true });
    const well = (await gm.waitFor((m) => m.type === 'event' && m.event.type === 'token.upsert' && m.event.token.name === 'Well')).event.token;
    expect(well).toMatchObject({ locked: true, size: 2, miniId: 'village-well' });
    pl.send('mi6', { type: 'token.move', id: well.id, x: 210, y: 210, baseVersion: well.version });
    expect((await pl.ack('mi6')).code).toBe('forbidden');
    gm.send('mi7', { type: 'token.update', id: well.id, patch: { miniId: null }, baseVersion: well.version });
    expect((await gm.ack('mi7')).ok).toBe(true);
    const snap = await gm.api('GET', '/api/sessions/' + sessionId + '/snapshot');
    expect(snap.tokens.find((x: any) => x.id === t.id)).toMatchObject({ miniId: 'hooded-wanderer', rotation: 90 });
    expect(snap.tokens.find((x: any) => x.id === well.id).miniId).toBeNull();
    for (const id of [t.id, well.id]) { gm.send('del-' + id, { type: 'token.delete', id }); await gm.ack('del-' + id); }
  });

  it('resolves concurrent moves deterministically (first wins, loser gets current state)', async () => {
    const snap = await gm.api('GET', '/api/sessions/' + sessionId + '/snapshot');
    const tok = snap.tokens[0];
    gm.send('g2', { type: 'token.move', id: tok.id, x: 245, y: 35, baseVersion: tok.version });
    pl.send('p2', { type: 'token.move', id: tok.id, x: 35, y: 245, baseVersion: tok.version });
    const [a, b] = await Promise.all([gm.ack('g2'), pl.ack('p2')]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(loser.code).toBe('stale');
    expect(loser.current.version).toBe(tok.version + 1);
  });

  it('does not re-apply duplicated commands', async () => {
    pl.send('dup', { type: 'chat.send', body: 'once' });
    pl.send('dup', { type: 'chat.send', body: 'once' });
    await pl.ack('dup'); await pl.ack('dup');
    await new Promise((r) => setTimeout(r, 150));
    const snap = await gm.api('GET', '/api/sessions/' + sessionId + '/snapshot');
    expect(snap.chat.filter((c: any) => c.body === 'once')).toHaveLength(1);
  });

  it('streams hidden tokens only to the GM and removes tokens covered by fog', async () => {
    gm.send('h1', { type: 'token.create', name: 'Ambusher', x: 500, y: 500, hidden: true });
    const created = await gm.waitFor((m) => m.type === 'event' && m.event.type === 'token.upsert' && m.event.token.name === 'Ambusher');
    await gm.ack('h1');
    gm.send('h2', { type: 'token.create', name: 'Ogre', x: 600, y: 600 });
    await pl.waitFor((m) => m.type === 'event' && m.event.type === 'token.upsert' && m.event.token.name === 'Ogre');
    gm.send('f1', { type: 'fog.reset', enabled: true });
    await pl.waitFor((m) => m.type === 'event' && m.event.type === 'fog.updated');
    await pl.waitFor((m) => m.type === 'event' && m.event.type === 'token.remove');
    await new Promise((r) => setTimeout(r, 150));
    const all = JSON.stringify(pl.msgs) + JSON.stringify(await pl.api('GET', '/api/sessions/' + sessionId + '/snapshot'));
    expect(all).not.toContain('Ambusher');
    expect(all).not.toContain(created.event.token.id);
  });

  it('shares public dice rolls with everyone', async () => {
    gm.msgs = []; pl.msgs = [];
    pl.send('r1', { type: 'dice.roll', expression: '1d20+5' });
    const g = await gm.waitFor((m) => m.type === 'event' && m.event.type === 'chat.message' && m.event.message.kind === 'roll');
    const p = await pl.waitFor((m) => m.type === 'event' && m.event.type === 'chat.message' && m.event.message.kind === 'roll');
    expect(g.event.message.roll.total).toBe(p.event.message.roll.total);
  });

  it('rejects malformed commands without crashing the room', async () => {
    pl.ws.send('not json');
    pl.send('bad', { type: 'token.teleport_all' });
    expect((await pl.ack('bad')).code).toBe('invalid');
    pl.send('ok', { type: 'ping', x: 1, y: 1 });
    expect((await pl.ack('ok')).ok).toBe(true);
  });

  it('recognises a command resent after reconnecting', async () => {
    pl.send('across', { type: 'chat.send', body: 'resent-after-reconnect' });
    await pl.ack('across');
    pl.ws.close();
    await pl.connect(sessionId);
    pl.send('across', { type: 'chat.send', body: 'resent-after-reconnect' });
    expect((await pl.ack('across')).ok).toBe(true);
    const snap = await gm.api('GET', '/api/sessions/' + sessionId + '/snapshot');
    expect(snap.chat.filter((c: any) => c.body === 'resent-after-reconnect')).toHaveLength(1);
  });

  it('reconnects with a full snapshot that reflects the latest state', async () => {
    pl.ws.close();
    const snap = await pl.connect(sessionId);
    expect(snap.fog.length === 0 && snap.map?.fogEnabled).toBe(true);
    expect(snap.tokens.map((t) => t.name)).toEqual(['Hero']);
    gm.ws.close(); pl.ws.close();
  });
});
