# System overview

OPEN TABLETOP is a modular monolith: one Node process serves the JSON API, the WebSocket endpoint and the
built single-page app. PostgreSQL (or embedded PGlite) holds state; uploaded files go through a `Storage`
interface.

```
 Browser (React SPA)                        Node server (server/main.ts)
 ┌────────────────────────────┐   HTTPS    ┌──────────────────────────────────────┐
 │ pages/ (dashboard, campaign│──/api/*───▶│ app.ts  routes → Services (authz)    │
 │ invite, settings, rulesets)│            │                    │                 │
 │ table/SessionPage          │            │ hub.ts  rooms ─────┤                 │
 │  ├ engine.ts (PixiJS)      │◀──/ws─────▶│  serialized queue  ▼                 │
 │  ├ socket.ts (outbox)      │  WebSocket │            services.ts ──▶ db (pg / PGlite)
 │  └ store.ts (Zustand)      │            │                       └─▶ storage.ts (disk)
 └────────────────────────────┘            └──────────────────────────────────────┘
```

## Layers
- **shared/** — pure TypeScript used by both sides: grid geometry (`grid.ts`), dice parser (`dice.ts`),
  fog containment (`fog.ts`), roles and capabilities (`permissions.ts`), the realtime protocol schemas
  (`protocol.ts`) and ruleset contracts/modules (`rules/`). Nothing here touches the DOM, the network or
  the database, so it is unit-tested directly.
- **server/services.ts** — the application core. Every public method takes the acting user's id, loads the
  campaign membership and checks capabilities before reading or writing. HTTP and WebSocket handlers are thin
  adapters, so both paths get identical authorization.
- **server/hub.ts** — realtime rooms keyed by game session. Commands for a room run one at a time (a promise
  queue), each inside a database transaction, so all clients observe one order. Effects returned by services
  are delivered per recipient (role, ownership, fog).
- **server/app.ts** — minimal router, JSON body parsing with a 64 KB limit, CSRF header check, cookie auth,
  WebSocket upgrade with origin and membership checks, static file serving with SPA fallback.
- **web/src/table/** — the table workspace. `engine.ts` renders with PixiJS and owns all pointer
  interaction; React components (top bar, toolbar, side panel, dice bar, map setup) read the Zustand store.
  High-frequency pointer state (drag previews, rulers, pans) stays inside the engine and never re-renders React.

## Request flows
**HTTP**: `fetch` → `x-od-client: 1` header check → route → `me()` resolves the cookie to a user →
`Services.method(userId, …)` → JSON response or `{ error, code }`.

**Realtime**: client opens `/ws?session=<id>` → server verifies origin, cookie and membership → hub sends a
filtered `snapshot` → client sends `{ cid, cmd }` → hub validates (zod), rate-limits, de-duplicates by
`cid`, queues → `Services.applyCommand` authorizes and writes in a transaction, bumps the session `seq`
→ sender gets an `ack`, everyone permitted gets `event`s. See realtime-protocol.md.

## Campaigns, sessions, maps
A campaign owns members, maps and assets. A game session is one table event of a campaign; it points at an
`active_map_id`. A new session reuses the campaign's most recent map, so the next session resumes the saved
table. Tokens, fog regions and drawings belong to the map; chat, dice rolls and the encounter belong to the
session.

## Configuration
`server/config.ts` reads `PORT`, `DATABASE_URL`, `DATA_DIR`, `MAX_UPLOAD_BYTES` and `COOKIE_SECURE`.
See docs/development/local-setup.md.
