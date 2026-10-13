# Deployment

OPEN TABLETOP is one long-running Node process. It needs a host that keeps WebSocket connections open
(a VM, container platform, Fly/Render/Railway-style service, or your own machine). Serverless functions
(e.g. Vercel functions) cannot host the `/ws` endpoint.

## Static hosting (Vercel, GitHub Pages): local mode

A static host serves only `dist/`, so `/api` and `/ws` don't exist there — this used to make sign-in fail
with a 404. The client now detects that (`/api/me` doesn't answer with JSON within 5 s) and switches to
**local mode** (`web/src/local/`): the same server code (`server/routes.ts`, services, realtime hub) runs inside
the browser tab on PGlite persisted to IndexedDB. Sign-in, campaigns, characters, journals, maps and the live
table work; data stays on that device and invites can't reach other devices. A notice on the title page says
so. `vercel.json` adds SPA rewrites so deep links (`/campaigns/…`, `/invite/…`) load. Force it at build time
with `VITE_LOCAL_MODE=1`. Tested by `npm run test:e2e:local`.

## Multiplayer server (Docker, Shadw, DevHub)

`Dockerfile` builds the client and runs the server (`/data` volume for PGlite + uploads, or set
`DATABASE_URL`). `shadw.yml` / `devhub.yml` deploy the same long-running service on Shadw or Autheo DevHub.

## Build and run
```bash
npm ci
npx vite build          # → dist/
NODE_ENV=production PORT=8787 DATABASE_URL=postgres://… DATA_DIR=/var/lib/opentabletop COOKIE_SECURE=1 npm start
```
The server applies pending migrations at startup and serves `dist/` if it exists. Health check: `GET /healthz`.

## Checklist
- **HTTPS** via a reverse proxy (Caddy, nginx, a platform load balancer). Forward WebSocket upgrades for `/ws`
  and preserve the `Host` header (the server compares `Origin` with `Host`). Set `COOKIE_SECURE=1`.
- **Database**: PostgreSQL 14+ via `DATABASE_URL`. PGlite (no `DATABASE_URL`) is fine for a single small table but
  stores data on local disk — back up `DATA_DIR`.
- **Uploads** live in `DATA_DIR/uploads`; put `DATA_DIR` on a persistent volume and back it up.
- **Rate limiting**: add a per-IP limit for `/api/*` at the proxy (the app only rate-limits realtime commands).
- **Auth**: today only development sign-in exists — anyone who can reach the server can create an account
  (campaigns are still invite-only). Don't expose it publicly until a real provider is configured.
- **Scaling**: rooms are in memory, so run a single instance (or sticky sessions per game session).
- **Secrets**: none are required today. Never commit `.env`.
