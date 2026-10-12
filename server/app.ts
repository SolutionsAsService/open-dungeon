/**
 * HTTP API + WebSocket upgrade on one Node server (modular monolith). See docs/architecture/system-overview.md.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { Services } from './services';
import { Hub } from './hub';
import { HttpError, badRequest, notFound, unauthorized } from './errors';
import { Role } from '../shared/permissions';
import { CharacterCreate, CharacterUpdate } from '../shared/characters';
import { JournalCreate, JournalUpdate } from '../shared/journal';

const COOKIE = 'od_session';
const JSON_LIMIT = 64 * 1024;

type Ctx = { req: http.IncomingMessage; res: http.ServerResponse; params: Record<string, string>; url: URL };
type Handler = (c: Ctx) => Promise<unknown>;

export function createApp(svc: Services, opts: { staticDir?: string | null; secureCookies?: boolean } = {}) {
  const hub = new Hub(svc);
  const routes: { method: string; re: RegExp; keys: string[]; h: Handler }[] = [];
  const route = (method: string, pattern: string, h: Handler) => {
    const keys: string[] = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([A-Za-z0-9_-]{1,100})'; }) + '$');
    routes.push({ method, re, keys, h });
  };
  const cookieToken = (req: http.IncomingMessage) => {
    const m = /(?:^|;\s*)od_session=([^;]+)/.exec(req.headers.cookie ?? '');
    return m ? decodeURIComponent(m[1]) : null;
  };
  const me = async (c: Ctx) => { const u = await svc.userForToken(cookieToken(c.req)); if (!u) throw unauthorized(); return u; };
  const body = async <T>(c: Ctx, schema: z.ZodType<T>): Promise<T> => {
    const raw = await readBody(c.req, JSON_LIMIT);
    let data: unknown;
    try { data = raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch { throw badRequest('Malformed JSON'); }
    const r = schema.safeParse(data);
    if (!r.success) throw badRequest(r.error.issues.map((i) => (i.path.join('.') || 'body') + ': ' + i.message).join('; '));
    return r.data;
  };

  // ---- auth (development strategy; see docs/decisions/0003-dev-auth.md) ----
  route('POST', '/api/auth/dev', async (c) => {
    const { displayName } = await body(c, z.object({ displayName: z.string().trim().min(1).max(40) }));
    const { user, token } = await svc.devSignIn(displayName);
    c.res.setHeader('Set-Cookie', COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + 30 * 86400 + (opts.secureCookies ? '; Secure' : ''));
    return { user };
  });
  route('POST', '/api/auth/logout', async (c) => {
    const t = cookieToken(c.req); if (t) await svc.signOut(t);
    c.res.setHeader('Set-Cookie', COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return { ok: true };
  });
  route('GET', '/api/me', async (c) => ({ user: await svc.userForToken(cookieToken(c.req)) }));

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
    const data = await readBody(c.req, svc.opts.maxUploadBytes + 1);
    const name = String(c.req.headers['x-filename'] ?? '').slice(0, 120);
    return svc.uploadImage(u.id, c.params.id, data, { name, kind: String(c.url.searchParams.get('kind') ?? 'image').slice(0, 32) });
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
  route('GET', '/api/invites/:token', async (c) => svc.previewInvite(c.params.token));
  route('POST', '/api/invites/:token/accept', async (c) => svc.acceptInvite((await me(c)).id, c.params.token));

  // ---- assets & sessions ----
  route('GET', '/api/assets/:id', async (c) => {
    const a = await svc.readAsset((await me(c)).id, c.params.id);
    c.res.writeHead(200, { 'Content-Type': a.mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
    c.res.end(a.data);
    return undefined;
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

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (url.pathname.startsWith('/api/')) {
      // CSRF defence: state-changing requests must come from our own JS (custom header can't be sent cross-site without CORS).
      if (req.method !== 'GET' && req.headers['x-od-client'] !== '1') return sendJson(res, 403, { error: 'Missing client header', code: 'forbidden' });
      const r = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
      if (!r) return sendJson(res, 404, { error: 'Not found', code: 'not_found' });
      const m = r.re.exec(url.pathname)!;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
      try {
        const out = await r.h({ req, res, params, url });
        if (out !== undefined && !res.headersSent) sendJson(res, 200, out);
      } catch (e) {
        if (e instanceof HttpError) sendJson(res, e.status, { error: e.message, code: e.code });
        else { console.error('request failed', req.method, url.pathname, (e as Error).message); sendJson(res, 500, { error: 'Something went wrong', code: 'server_error' }); }
      }
      return;
    }
    if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true });
    if (opts.staticDir) return serveStatic(opts.staticDir, url.pathname, res);
    sendJson(res, 404, { error: 'Not found' });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', async (req, socket, head) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/ws') throw notFound();
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'forbidden', 'Bad origin');
      const user = await svc.userForToken(cookieToken(req));
      if (!user) throw unauthorized();
      const sessionId = url.searchParams.get('session') ?? '';
      await svc.sessionContext(user.id, sessionId); // membership check before upgrading
      wss.handleUpgrade(req, socket, head, (ws) => { hub.join(ws, user.id, sessionId).catch(() => ws.close(4404, 'not found')); });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      socket.write('HTTP/1.1 ' + status + ' ' + (http.STATUS_CODES[status] ?? '') + '\r\nConnection: close\r\n\r\n');
      socket.destroy();
    }
  });
  return { server, hub };
}

function sendJson(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'too_large', 'Request body is too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };
function serveStatic(dir: string, pathname: string, res: http.ServerResponse) {
  const root = path.resolve(dir);
  let file = path.resolve(root, '.' + decodeURIComponent(pathname));
  if (!file.startsWith(root + path.sep) && file !== root) return sendJson(res, 404, { error: 'Not found' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html'); // SPA fallback
  if (!fs.existsSync(file)) return sendJson(res, 404, { error: 'Not found' });
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': file.includes(path.sep + 'assets' + path.sep) ? 'public, max-age=31536000, immutable' : 'no-cache' });
  fs.createReadStream(file).pipe(res);
}
