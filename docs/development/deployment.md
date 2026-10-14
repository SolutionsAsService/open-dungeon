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

## Private miniatures

The real miniatures live in private repos (fantasy-miniatures, scifi-miniatures, catalogued by miniature-viewer); this
repo is public and never contains their meshes (ADR [0011](../decisions/0011-private-minis-and-uploads.md)). Two ways
to get them into a deployment:

### 1. Server-side source (multiplayer server: Docker, Shadw, DevHub) — recommended
The server reads the catalogue itself and serves it only to signed-in members of a campaign.

| Variable | Meaning |
|---|---|
| `MINI_LIBRARY_SOURCES` | space/comma separated: `github:Owner/repo@ref[:path]`, an `https://` viewer URL, or a folder path |
| `MINI_LIBRARY_TOKEN` | GitHub token for `github:` sources (falls back to `GITHUB_TOKEN`). Secret — set in the platform, never commit |
| `MINI_LIBRARY_TTL_SECONDS` | how long the catalogue is cached before re-reading (default 3600) |

Owner setup:
1. Create a **fine-grained personal access token** (GitHub → Settings → Developer settings) with *Contents: read-only*
   on `SolutionsAsService/miniature-viewer` only.
2. **Shadw**: `.github/shadw.yml` already sets `MINI_LIBRARY_SOURCES=github:SolutionsAsService/miniature-viewer@main`.
   Add `MINI_LIBRARY_TOKEN` as a secret environment variable in the Shadw project settings and redeploy.
   (DevHub: same variables in its project settings.)
3. **Docker**:
   ```bash
   docker run -p 8787:8787 -v od-data:/data \
     -e MINI_LIBRARY_SOURCES=github:SolutionsAsService/miniature-viewer@main \
     -e MINI_LIBRARY_TOKEN=github_pat_… open-tabletop
   ```
   (Use `--env-file` or your orchestrator's secret store rather than the shell history.)
4. **Own machine**: point at a checkout instead — `MINI_LIBRARY_SOURCES=../miniature-viewer npm start`.

Check: open a table, Minis tab — the private figures appear under Figures/Scenery. If not, the server log says
`mini library source failed (github): …` (bad token → HTTP 404/401). Meshes are fetched once per cache period; members'
browsers fetch them from `/api/campaigns/:id/minis/:mini/mesh` (404 for non-members).

### 2. Build-time import (static hosts, or a server image with the minis baked in)
`tools/miniatures/import-library.ts` accepts the same sources and writes git-ignored `web/src/minis/library.json` +
`public/minis/*.parts.json` before `vite build`:
```bash
MINI_LIBRARY_TOKEN=github_pat_… npx tsx tools/miniatures/import-library.ts github:SolutionsAsService/miniature-viewer@main
# or with the gh CLI logged in: npx tsx tools/miniatures/import-library.ts github:SolutionsAsService/miniature-viewer@main
docker build --build-arg MINI_LIBRARY=github:SolutionsAsService/miniature-viewer@main \
  --secret id=mini_library_token,env=MINI_LIBRARY_TOKEN -t open-tabletop .
```
The token is a BuildKit secret (never in a layer). **Anything bundled is public to whoever can load that site** — only
use this for private/password-protected hosts or when the owner decides to publish those minis.

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
- **Secrets**: only `MINI_LIBRARY_TOKEN` (optional, see Private miniatures). Never commit `.env`.
