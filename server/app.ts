/**
 * HTTP API + WebSocket upgrade on one Node server (modular monolith). See docs/architecture/system-overview.md.
 * Routes live in server/routes.ts (shared with the in-browser local mode).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { Services } from './services';
import { Hub } from './hub';
import { HttpError, notFound, unauthorized } from './errors';
import { createApi, cookieToken as parseCookie, JSON_LIMIT } from './routes';

export function createApp(svc: Services, opts: { staticDir?: string | null; secureCookies?: boolean } = {}) {
  const hub = new Hub(svc);
  const api = createApi(svc, hub, { secureCookies: opts.secureCookies });
  const cookieToken = (req: http.IncomingMessage) => parseCookie(req.headers.cookie);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (url.pathname.startsWith('/api/')) {
      let body: Buffer = Buffer.alloc(0);
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') body = await readBody(req, Math.max(JSON_LIMIT, svc.opts.maxUploadBytes + 1));
      } catch (e) {
        const he = e instanceof HttpError ? e : new HttpError(400, 'invalid', 'Bad request');
        return sendJson(res, he.status, { error: he.message, code: he.code });
      }
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : v;
      const out = await api.dispatch({ method: req.method ?? 'GET', path: url.pathname, search: url.search, headers, body });
      res.writeHead(out.status, out.headers);
      return res.end(out.binary ?? JSON.stringify(out.json));
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
