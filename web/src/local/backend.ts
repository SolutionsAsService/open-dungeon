/**
 * Local mode: the full OPEN TABLETOP server (services, realtime hub, routes) running inside this
 * browser tab, with PGlite persisted to IndexedDB. Used automatically when the page is served
 * without the Node server (static hosts such as Vercel/GitHub Pages), so sign-in and solo/GM prep
 * work everywhere. Multiplayer across devices still needs the server (docs/development/deployment.md).
 */
import { Buffer } from 'buffer';
(globalThis as any).Buffer ??= Buffer;

import type { Db, Queryable } from '../../../server/db/index';
import type { Storage } from '../../../server/storage';
import type { ApiRequest, ApiResponse } from '../../../server/routes';

const MIGRATIONS = import.meta.glob('../../../server/db/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

async function openBrowserDb(): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite('idb://open-dungeon');
  await db.waitReady;
  let chain: Promise<unknown> = Promise.resolve();
  const q: Queryable = { async query(sql, params = []) { return (await db.query(sql, params as any[])).rows as any[]; } };
  return {
    query: q.query,
    tx(fn) {
      const run = chain.then(() => db.transaction(async (t) => fn({ async query(sql, params = []) { return (await t.query(sql, params as any[])).rows as any[]; } })));
      chain = run.catch(() => undefined);
      return run as any;
    },
    async close() { await db.close(); },
  };
}

async function migrateBrowser(db: Db) {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const done = new Set((await db.query<{ id: string }>('SELECT id FROM schema_migrations')).map((r) => r.id));
  for (const [path, sql] of Object.entries(MIGRATIONS).sort(([a], [b]) => a.localeCompare(b))) {
    const id = path.split('/').pop()!;
    if (done.has(id)) continue;
    await db.tx(async (t) => {
      for (const stmt of sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await t.query(stmt);
      await t.query('INSERT INTO schema_migrations (id) VALUES ($1)', [id]);
    });
  }
}

/** Uploaded images in IndexedDB so map backgrounds and token art survive reloads. */
class IdbStorage implements Storage {
  private db = new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('open-dungeon-uploads', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db;
    return new Promise((resolve, reject) => { const req = fn(db.transaction('files', mode).objectStore('files')); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  }
  async put(key: string, data: Buffer) { await this.tx('readwrite', (s) => s.put(new Uint8Array(data), key)); }
  async get(key: string) { const v = await this.tx<Uint8Array | undefined>('readonly', (s) => s.get(key)); return v ? Buffer.from(v) : null; }
  async delete(key: string) { await this.tx('readwrite', (s) => s.delete(key)); }
}

/** Server-side end of an in-tab socket: the subset of the `ws` API the Hub uses. */
class HubSocket {
  readyState = 1;
  private handlers: Record<string, ((arg?: any) => void)[]> = {};
  constructor(private deliver: (data: string) => void, private onClose: (code: number, reason: string) => void) {}
  on(ev: string, fn: (arg?: any) => void) { (this.handlers[ev] ??= []).push(fn); return this; }
  emit(ev: string, arg?: any) { for (const fn of this.handlers[ev] ?? []) fn(arg); }
  send(data: string) { if (this.readyState === 1) queueMicrotask(() => this.deliver(data)); }
  close(code = 1000, reason = '') { if (this.readyState !== 1) return; this.readyState = 3; this.emit('close'); this.onClose(code, reason); }
}

/** Client-side end, shaped like a browser WebSocket for web/src/table/socket.ts. */
export class LocalWebSocket {
  static OPEN = 1;
  readyState = 0;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  private server: HubSocket | null = null;
  constructor(sessionId: string) {
    backend().then(async (b) => {
      const user = await b.svc.userForToken(localToken());
      try {
        if (!user) throw new Error('unauthorized');
        await b.svc.sessionContext(user.id, sessionId);
      } catch { this.readyState = 3; this.onclose?.({ code: 4404 }); return; }
      this.server = new HubSocket((data) => this.onmessage?.({ data }), (code) => { this.readyState = 3; this.onclose?.({ code }); });
      this.readyState = 1;
      b.hub.join(this.server as any, user.id, sessionId).catch(() => this.server?.close(4404, 'not found'));
    });
  }
  send(data: string) { if (this.readyState === 1) this.server?.emit('message', data); }
  close() { const s = this.server; this.readyState = 3; if (s && s.readyState === 1) s.close(1000, ''); else this.onclose?.({ code: 1000 }); }
}

const TOKEN_KEY = 'od_local_session';
const localToken = () => localStorage.getItem(TOKEN_KEY);

type Backend = { svc: import('../../../server/services').Services; hub: import('../../../server/hub').Hub; dispatch: (r: ApiRequest) => Promise<ApiResponse> };
let instance: Promise<Backend> | null = null;
export function backend(): Promise<Backend> {
  return (instance ??= (async () => {
    const [{ Services }, { Hub }, { createApi }] = await Promise.all([
      import('../../../server/services'), import('../../../server/hub'), import('../../../server/routes'),
    ]);
    const db = await openBrowserDb();
    await migrateBrowser(db);
    const svc = new Services(db, new IdbStorage(), { maxUploadBytes: 8 * 1024 * 1024 });
    const hub = new Hub(svc);
    const api = createApi(svc, hub, {});
    return { svc, hub, dispatch: api.dispatch };
  })());
}

/** fetch()-like entry point used by web/src/api.ts in local mode. Session cookie lives in localStorage. */
export async function localFetch(method: string, path: string, headers: Record<string, string>, body?: Uint8Array): Promise<{ status: number; json?: any; binary?: Uint8Array; contentType?: string }> {
  const b = await backend();
  const url = new URL(path, location.origin);
  const token = localToken();
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  if (token) lower.cookie = 'od_session=' + encodeURIComponent(token);
  const out = await b.dispatch({ method, path: url.pathname, search: url.search, headers: lower, body: body ?? new Uint8Array() });
  const set = out.headers['Set-Cookie'];
  if (set) {
    const m = /^od_session=([^;]*)/.exec(set);
    if (m && m[1] && !/Max-Age=0/.test(set)) localStorage.setItem(TOKEN_KEY, decodeURIComponent(m[1])); else localStorage.removeItem(TOKEN_KEY);
  }
  return { status: out.status, json: out.json, binary: out.binary, contentType: out.headers['Content-Type'] };
}
