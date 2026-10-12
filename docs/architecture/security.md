# Security

## Principles in the code
- **Server-side authorization everywhere.** `server/services.ts` methods take the acting user id and check
  campaign membership and capabilities (`shared/permissions.ts`) themselves. The realtime path calls the same
  methods, so HTTP and WebSocket authorization cannot drift. Client role checks only hide controls.
- **No existence leaks.** Non-members get 404 (not 403) for campaigns, sessions, assets and invites.
- **Hidden data never leaves the server.** Hidden tokens, tokens under fog (for players who don't own them),
  GM-only drawings, private/GM rolls and hidden combatants are filtered per recipient in snapshots and events
  (`Services.snapshot`, `Hub.deliver`). Integration and E2E tests assert the serialized payloads don't contain them.

## Roles
| Role | Can |
|---|---|
| owner | everything a GM can, plus manage member roles |
| gm | invite, manage sessions, edit maps/fog/tokens/initiative, see hidden data, GM-only drawings and rolls |
| assistant_gm | GM table powers, but cannot invite or manage sessions |
| player | move/edit tokens they own (unless locked), roll, chat, draw public annotations, measure |
| spectator | read-only (no rolls, chat or drawings) |

## Authentication (current: development strategy)
- `POST /api/auth/dev` creates a user for a display name and sets `od_session` (HttpOnly, SameSite=Lax,
  30-day Max-Age, `Secure` when `COOKIE_SECURE=1`).
- The cookie holds 256 random bits; only its SHA-256 is stored (`auth_sessions.token_hash`). Logout deletes the row.
- Dev auth has no password and no account recovery — it is for local play and tests. See ADR 0003 and the roadmap
  for the OIDC provider.

## Requests
- **CSRF**: every non-GET `/api/*` request must carry `x-od-client: 1`. Browsers cannot add custom headers
  cross-site without a CORS preflight, which the server never grants. Cookies are also SameSite=Lax.
- **WebSocket**: origin host must match `Host`; cookie and membership are checked before the upgrade.
- **Input validation**: zod schemas at every boundary (HTTP bodies, realtime commands); JSON bodies ≤64 KB, WS frames ≤64 KB.
- **Rate limiting**: realtime commands 20/s per socket (burst 60). HTTP is not rate-limited yet — put a reverse
  proxy limit in front in production.
- **SQL**: parameterized queries only; the single dynamic UPDATE in `token.update` builds column names from a fixed whitelist.
- **Errors**: unexpected errors return a generic 500 and log method/path/message — never request bodies.

## Invitations
32-byte random tokens, stored hashed, with role (never owner/gm), optional expiry and max uses; accepting is
transactional (`FOR UPDATE`). Invalid, expired, exhausted and revoked invites all return the same 404.

## Uploads and assets
- Type is decided by magic bytes (PNG, JPEG, WebP, GIF) — never by filename or client content type.
- SVG is rejected until a sanitizer is in place (scriptable).
- Size limit `MAX_UPLOAD_BYTES` (default 20 MB) enforced while streaming.
- Storage keys are server-generated ids validated against `^[A-Za-z0-9_-]{1,80}$` — no user-controlled paths.
- Only GMs (map/token creators) can upload; only the uploader or campaign members can read.
- Assets are served with `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'` and
  `Cache-Control: private`.

## Dice
Server-side rolls only, CSPRNG with rejection sampling (`secureDie`), a hand-written parser (never `eval`) with
limits on length, terms, dice count and sides. Clients cannot submit results.

## Logging and privacy
`session_events` stores command type and target id only — never chat bodies or note text. The server logs no
private content.

## Static files
Path traversal is blocked by resolving under the `dist` root; unknown paths fall back to `index.html`.

## Known limitations
- Players download the full background image even where fog covers it.
- Fog region shapes (including GM "hide" regions) are sent to every member.
- Dev auth: anyone who can reach the server can create an account (they still need an invite to see a campaign).
- No audit trail of admin actions beyond `session_events`.
