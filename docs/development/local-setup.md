# Local setup

Requirements: Node.js ≥ 20 (CI uses 24) and npm. No database or other service is needed.

```bash
npm ci
npm run dev          # server on :8787 (tsx watch) + Vite on http://localhost:5173 (proxies /api and /ws)
```
Open http://localhost:5173, pick a name, create a campaign. Use a second browser profile (or a private window) to
join as a player via an invite link.

Production-like run:
```bash
npx vite build && npm start   # serves dist/ + API + WebSocket on http://localhost:8787
```

## Environment variables
Copy `.env.example` to `.env` (or export variables). Read by `server/config.ts`.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 8787 | HTTP + WebSocket port |
| `DATABASE_URL` | empty | PostgreSQL connection string. Empty → embedded PGlite at `DATA_DIR/db` |
| `DATA_DIR` | `.data` | PGlite data and local uploads (`DATA_DIR/uploads`) |
| `MAX_UPLOAD_BYTES` | 20971520 | upload size limit |
| `COOKIE_SECURE` | unset | `1` adds `Secure` to the session cookie (set behind HTTPS) |

The server does not load `.env` files itself; use your shell, `node --env-file=.env`, or your process manager.

## Database and migrations
Migrations in `server/db/migrations` run automatically at startup. To run them manually: `npm run db:migrate`.
To use PostgreSQL locally: `DATABASE_URL=postgres://user:pass@localhost:5432/opentabletop npm start`.
To reset local data: stop the server and delete `.data/`.

## Uploads
Stored under `DATA_DIR/uploads` with server-generated names. Only PNG, JPEG, WebP and GIF are accepted.
