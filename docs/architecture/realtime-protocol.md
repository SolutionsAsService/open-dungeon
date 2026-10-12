# Realtime protocol

Transport: one WebSocket per open table at `/ws?session=<sessionId>`, JSON text frames, max 64 KB.
Schemas: `shared/protocol.ts` (zod for client → server, TypeScript types for server → client).

## Connecting
1. The upgrade request must carry the `od_session` cookie. If an `Origin` header is present its host must equal
   `Host` (blocks cross-site WebSocket hijacking).
2. The server checks campaign membership for the session **before** upgrading; non-members get HTTP 404.
3. After upgrade the server sends `{ type: 'snapshot', snapshot }`, already filtered for the recipient: hidden
   tokens and tokens under fog are omitted for players (unless they own them), GM-only drawings, private rolls
   and hidden combatants are omitted.
4. If a socket is closed with code `4404` the session is gone or membership was lost; the client stops retrying.

## Client → server
```json
{ "cid": "k3j9x2-17", "cmd": { "type": "token.move", "id": "tok_…", "x": 315, "y": 175, "baseVersion": 3 } }
```
`cid` is a client-chosen id (≤64 chars). Commands: `token.create | token.move | token.update | token.delete`,
`map.update`, `fog.add | fog.reset`, `drawing.add | drawing.delete | drawing.clear`, `dice.roll`, `chat.send`,
`init.add | init.update | init.remove | init.advance | init.reset`, `ping`. Field limits are in the schema
(coordinates ±100 000, names ≤60 chars, chat ≤2000 chars, drawings ≤2000 points, fog polygons ≤500 points).

Processing order in `server/hub.ts`:
1. JSON parse and schema validation → `ack { ok:false, code:'invalid' }` on failure.
2. Token-bucket rate limit per socket: 20 commands/s, burst 60 → `code:'rate_limited'`.
3. De-duplication: the last 256 `cid`s are remembered **per user per room** (they survive reconnects). A repeat
   gets the original ack and is never applied twice.
4. The command joins the room's serial queue and runs inside a DB transaction via `Services.applyCommand`, which
   re-checks membership, session status (closed → `closed`; paused → only GMs) and capabilities.

## Server → client
- `{ type:'ack', cid, ok:true, seq }` — applied; `seq` is the session sequence number after the command.
- `{ type:'ack', cid, ok:false, code, error, current? }` — codes: `invalid`, `forbidden`, `stale`, `not_found`,
  `rate_limited`, `closed`. A `stale` token conflict includes the token's current state so the client can roll back.
- `{ type:'event', seq, event }` — events: `token.upsert`, `token.remove`, `map.updated`, `fog.updated`,
  `drawing.added`, `drawing.removed`, `chat.message`, `initiative.updated`, `presence`, `ping`, `session.status`.
- `{ type:'snapshot', snapshot }` — on join, and to every socket after a session status change (`resync`).

## Visibility filtering
Services return *effects* rather than raw broadcasts:
- `event` with an audience: `all`, `gm`, `users[ids]`, or `gmAndUsers[ids]` (e.g. a roll "to GM" reaches the roller and GMs).
- `tokens`: for each recipient the hub decides with `Services.tokenVisibleTo(role, user, token, revealed)`. A token that
  becomes invisible to someone (hidden, or moved/covered by fog) is sent as `token.remove`; one that becomes visible
  is sent as `token.upsert`. Each connection tracks which token ids it knows.
- `initiative`: recomputed and filtered per role (players never see hidden combatants; if the active one is hidden
  they see no active marker).

## Conflicts and ordering
- Every token mutation carries `baseVersion`. If it differs from the stored `version`, the command fails with
  `stale` (first writer wins, deterministic). The client snaps the token to `current`.
- Commands per session are strictly serialized; `seq` increases by one per applied command (pings don't bump it).

## Client behaviour (`web/src/table/socket.ts`)
- Unacknowledged commands sit in an outbox and are resent with the same `cid` after a reconnect.
- Reconnect backoff: `min(5 s, 300 ms × 2^attempt)`; reconnects immediately on the browser `online` event.
- Token moves are optimistic and rolled back on refusal.
- The top bar shows connecting / connected / reconnecting / offline plus "saving N" / "N changes pending" / "saved".

## HTTP endpoints that emit realtime effects
`POST /api/sessions/:id/status` (broadcast `session.status` + resync) and `POST /api/sessions/:id/background`
(`map.updated`). Uploads themselves (`POST /api/campaigns/:id/assets`) are plain HTTP.
