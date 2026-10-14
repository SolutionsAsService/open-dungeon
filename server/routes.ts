/**
 * Transport-agnostic HTTP API. The Node server (server/app.ts) and the in-browser local mode
 * (web/src/local) both dispatch through here, so routes, validation and authorization are shared.
 */
import { z } from 'zod';
import type { Services } from './services';
import type { Hub } from './hub';
import { HttpError, badRequest, unauthorized } from './errors';
import { Role } from '../shared/permissions';
import { CharacterCreate, CharacterUpdate } from '../shared/characters';
import { JournalCreate, JournalUpdate } from '../shared/journal';
import { UploadOptions } from './minis';

export const COOKIE = 'od_session';
export const JSON_LIMIT = 64 * 1024;

export interface ApiRequest {
  method: string;
  path: string;
  search?: string;
  /** lower-case header names */
  headers: Record<string, string | undefined>;
  /** raw request body; ignored for GET */
  body: Uint8Array;
}
export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  json?: unknown;
  binary?: Uint8Array;
}

interface Ctx { req: ApiRequest; params: Record<string, string>; url: URL; setCookie: (v: string) => void; raw: (limit: number) => Uint8Array }
type Handler = (c: Ctx) => Promise<unknown>;
const decoder = new TextDecoder();

export function cookieToken(cookie: string | undefined | null) {
  const m = /(?:^|;\s*)od_session=([^;]+)/.exec(cookie ?? '');
  return m ? decodeURIComponent(m[1]) : null;
}

export function createApi(svc: Services, hub: Hub, opts: { secureCookies?: boolean } = {}) {
  const routes: { method: string; re: RegExp; keys: string[]; h: Handler }[] = [];
  const route = (method: string, pattern: string, h: Handler) => {
    const keys: string[] = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([A-Za-z0-9_-]{1,100})'; }) + '$');
    routes.push({ method, re, keys, h });
  };
  const token = (c: Ctx) => cookieToken(c.req.headers.cookie);
  const me = async (c: Ctx) => { const u = await svc.userForToken(token(c)); if (!u) throw unauthorized(); return u; };
  const body = async <T>(c: Ctx, schema: z.ZodType<T>): Promise<T> => {
    const raw = c.raw(JSON_LIMIT);
    let data: unknown;
    try { data = raw.length ? JSON.parse(decoder.decode(raw)) : {}; } catch { throw badRequest('Malformed JSON'); }
    const r = schema.safeParse(data);
    if (!r.success) throw badRequest(r.error.issues.map((i) => (i.path.join('.') || 'body') + ': ' + i.message).join('; '));
    return r.data;
  };
  const sessionCookie = (value: string, maxAge: number) =>
    COOKIE + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (opts.secureCookies ? '; Secure' : '');

  // ---- auth (development strategy; see docs/decisions/0003-dev-auth.md) ----
  route('POST', '/api/auth/dev', async (c) => {
    const { displayName } = await body(c, z.object({ displayName: z.string().trim().min(1).max(40) }));
    const { user, token: t } = await svc.devSignIn(displayName);
    c.setCookie(sessionCookie(t, 30 * 86400));
    return { user };
  });
  route('POST', '/api/auth/logout', async (c) => {
    const t = token(c); if (t) await svc.signOut(t);
    c.setCookie(sessionCookie('', 0));
    return { ok: true };
  });
  route('GET', '/api/me', async (c) => ({ user: await svc.userForToken(token(c)) }));

  // ---- campaigns ----
  route('GET', '/api/campaigns', async (c) => ({ campaigns: await svc.listCampaigns((await me(c)).id) }));
  route('POST', '/api/campaigns', async (c) => {
    const u = await me(c);
    return svc.createCampaign(u.id, await body(c, z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(2000).optional(), rulesetId: z.string().max(64).optional() })));
  });
  route('GET', '/api/campaigns/:id', async (c) => svc.getCampaign((await me(c)).id, c.params.id));
  route('POST', '/api/campaigns/:id/sessions', async (c) => {
    const u = await me(c);
    return svc.createSession(u.id, c.params.id, await body(c, z.object({ name: z.string().trim().min(1).max(80) })));
  });
  route('POST', '/api/campaigns/:id/members/:userId', async (c) => {
    const u = await me(c);
    await svc.setMemberRole(u.id, c.params.id, c.params.userId, (await body(c, z.object({ role: Role }))).role);
    return { ok: true };
  });
  route('POST', '/api/campaigns/:id/invites', async (c) => {
    const u = await me(c);
    const input = await body(c, z.object({ role: z.enum(['assistant_gm', 'player', 'spectator']).default('player'), expiresInHours: z.number().int().min(1).max(24 * 90).nullable().optional(), maxUses: z.number().int().min(1).max(100).nullable().optional() }));
    const inv = await svc.createInvite(u.id, c.params.id, input);
    return { id: inv.id, path: '/invite/' + inv.token };
  });
  route('POST', '/api/campaigns/:id/assets', async (c) => {
    const u = await me(c);
    const data = c.raw(svc.opts.maxUploadBytes + 1);
    const name = String(c.req.headers['x-filename'] ?? '').slice(0, 120);
    return svc.uploadImage(u.id, c.params.id, Buffer.from(data), { name, kind: String(c.url.searchParams.get('kind') ?? 'image').slice(0, 32) });
  });
  // ---- characters (authorization inside CharacterService) ----
  route('GET', '/api/campaigns/:id/characters', async (c) => ({ characters: await svc.characters.list((await me(c)).id, c.params.id) }));
  route('POST', '/api/campaigns/:id/characters', async (c) => {
    const u = await me(c);
    return svc.characters.create(u.id, c.params.id, await body(c, CharacterCreate));
  });
  route('GET', '/api/characters/:id', async (c) => (await svc.characters.get((await me(c)).id, c.params.id)).character);
  route('PATCH', '/api/characters/:id', async (c) => {
    const u = await me(c);
    return svc.characters.update(u.id, c.params.id, await body(c, CharacterUpdate));
  });
  route('DELETE', '/api/characters/:id', async (c) => svc.characters.remove((await me(c)).id, c.params.id));
  // ---- journals & handouts (authorization inside JournalService; changes pushed live to open tables) ----
  route('GET', '/api/campaigns/:id/journal', async (c) => ({ entries: await svc.journal.list((await me(c)).id, c.params.id) }));
  route('POST', '/api/campaigns/:id/journal', async (c) => {
    const u = await me(c);
    const ch = await svc.journal.create(u.id, c.params.id, await body(c, JournalCreate));
    hub.journalChanged(ch);
    return ch.after;
  });
  route('GET', '/api/journal/:id', async (c) => (await svc.journal.get((await me(c)).id, c.params.id)).entry);
  route('PATCH', '/api/journal/:id', async (c) => {
    const u = await me(c);
    const ch = await svc.journal.update(u.id, c.params.id, await body(c, JournalUpdate));
    hub.journalChanged(ch);
    return ch.after;
  });
  route('DELETE', '/api/journal/:id', async (c) => { hub.journalChanged(await svc.journal.remove((await me(c)).id, c.params.id)); return { ok: true }; });
  // ---- miniatures (private library sources; members only) ----
  route('GET', '/api/campaigns/:id/minis', async (c) => svc.minis.list((await me(c)).id, c.params.id));
  route('GET', '/api/campaigns/:id/minis/:mini/mesh', async (c) => ({ __binary: new Uint8Array(await svc.minis.mesh((await me(c)).id, c.params.id, c.params.mini)), mime: 'application/json' }));
  // bring-your-own figures: raw STL/OBJ/GLB/glTF body, options in the query string
  route('POST', '/api/campaigns/:id/minis', async (c) => {
    const u = await me(c);
    const o = UploadOptions.safeParse(Object.fromEntries(c.url.searchParams));
    if (!o.success) throw badRequest(o.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; '));
    return svc.minis.upload(u.id, c.params.id, Buffer.from(c.raw(svc.opts.maxUploadBytes + 1)), o.data);
  });
  route('PATCH', '/api/campaigns/:id/minis/:mini', async (c) => {
    const u = await me(c);
    return svc.minis.rename(u.id, c.params.id, c.params.mini, (await body(c, z.object({ name: z.string().trim().min(1).max(60) }))).name);
  });
  route('DELETE', '/api/campaigns/:id/minis/:mini', async (c) => svc.minis.remove((await me(c)).id, c.params.id, c.params.mini));
  route('PATCH', '/api/campaigns/:id/mini-settings', async (c) => {
    const u = await me(c);
    return svc.minis.setPlayerUploads(u.id, c.params.id, (await body(c, z.object({ playerUploads: z.boolean() }))).playerUploads);
  });
  route('GET', '/api/invites/:token', async (c) => svc.previewInvite(c.params.token));
  route('POST', '/api/invites/:token/accept', async (c) => svc.acceptInvite((await me(c)).id, c.params.token));

  // ---- assets & sessions ----
  route('GET', '/api/assets/:id', async (c) => {
    const a = await svc.readAsset((await me(c)).id, c.params.id);
    return { __binary: new Uint8Array(a.data), mime: a.mime };
  });
  route('GET', '/api/sessions/:id/snapshot', async (c) => svc.snapshot((await me(c)).id, c.params.id, hub.online(c.params.id)));
  route('POST', '/api/sessions/:id/status', async (c) => {
    const u = await me(c);
    const { status } = await body(c, z.object({ status: z.enum(['open', 'paused', 'closed']) }));
    const r = await svc.setSessionStatus(u.id, c.params.id, status);
    hub.broadcast(c.params.id, { type: 'session.status', status });
    await hub.resync(c.params.id);
    return r;
  });
  route('POST', '/api/sessions/:id/background', async (c) => {
    const u = await me(c);
    const { assetId } = await body(c, z.object({ assetId: z.string().max(64).nullable() }));
    const { seq, effects } = await svc.setMapBackground(u.id, c.params.id, assetId);
    await hub.deliver(c.params.id, seq, effects);
    return { ok: true };
  });

  async function dispatch(req: ApiRequest): Promise<ApiResponse> {
    const json = (status: number, data: unknown, headers: Record<string, string> = {}): ApiResponse =>
      ({ status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }, json: data });
    // CSRF defence: state-changing requests must come from our own JS (custom header can't be sent cross-site without CORS).
    if (req.method !== 'GET' && req.headers['x-od-client'] !== '1') return json(403, { error: 'Missing client header', code: 'forbidden' });
    const r = routes.find((x) => x.method === req.method && x.re.test(req.path));
    if (!r) return json(404, { error: 'Not found', code: 'not_found' });
    const m = r.re.exec(req.path)!;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
    const extra: Record<string, string> = {};
    const ctx: Ctx = {
      req, params, url: new URL(req.path + (req.search ?? ''), 'http://localhost'),
      setCookie: (v) => { extra['Set-Cookie'] = v; },
      raw: (limit) => { if (req.body.length > limit) throw new HttpError(413, 'too_large', 'Request body is too large'); return req.body; },
    };
    try {
      const out = await r.h(ctx) as any;
      if (out && out.__binary instanceof Uint8Array) {
        return { status: 200, headers: { 'Content-Type': out.mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" }, binary: out.__binary };
      }
      return json(200, out ?? {}, extra);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message, code: e.code }, extra);
      console.error('request failed', req.method, req.path, (e as Error).message);
      return json(500, { error: 'Something went wrong', code: 'server_error' });
    }
  }
  return { dispatch };
}
