# Repository assessment

_Last updated: 2026-10-12. Describes the repository as it is, not as planned._

## Starting point
The repository (SolutionsAsService/open-dungeon) started empty apart from a README, so there was no
existing stack to preserve. The foundation was built from scratch following docs/PROJECT-BRIEF.md.
Baseline at the time of this assessment: `npm run typecheck`, `npm test` (50 tests, 7 files),
`npx vite build` and the Playwright MVP flow all pass locally and in GitHub Actions.

## What the stack is
| Concern | Choice in the code | Where |
|---|---|---|
| Frontend | Vite 8 + React 19 + TypeScript SPA, tiny in-house history router | `web/src`, `web/src/router.tsx` |
| Styling | Tailwind CSS v4 with CSS design tokens (dark default, light theme, text scale) | `web/src/styles.css` |
| Table rendering | PixiJS v8 (WebGL), one engine class owning camera, layers and pointer input | `web/src/table/engine.ts` |
| Client state | Zustand store fed by server snapshot + events | `web/src/table/store.ts` |
| Backend | One Node HTTP server (no framework): REST routes + WebSocket upgrade (`ws`) + static SPA | `server/app.ts`, `server/main.ts` |
| Domain logic | `Services` class — every read/write takes the acting user id and authorizes itself | `server/services.ts` |
| Realtime | Per-session rooms, serialized command queue, per-recipient filtering | `server/hub.ts`, `shared/protocol.ts` |
| Database | PostgreSQL via `DATABASE_URL`, or embedded PGlite (same SQL) at `DATA_DIR/db` | `server/db/index.ts` |
| Migrations | Plain ordered SQL files, applied on boot and by `npm run db:migrate` | `server/db/migrations` |
| Validation | zod schemas shared by client and server | `shared/*.ts` |
| Auth | Development sign-in (display name → opaque cookie token, hashed at rest) | `server/services.ts` (devSignIn) |
| Object storage | `Storage` interface; local disk implementation, in-memory for tests | `server/storage.ts` |
| Game systems | Typed ruleset modules (generic, d20 demo, homebrew narrative) | `shared/rules` |
| Tests | Vitest unit + integration (real PGlite, real WebSocket clients); Playwright E2E | `tests/` |
| CI | GitHub Actions: typecheck, unit/integration, build, Playwright (chromium) | `.github/workflows/ci.yml` |
| Deployment | Single process (`npm start`) serving API, WebSocket and `dist/` | see docs/development/deployment.md |

## Notable deviations from the brief's suggested architecture
- **No Next.js.** The brief suggests Next.js; we use a Vite SPA plus a dedicated Node server because the
  table needs long-lived WebSockets and there is no SEO/SSR requirement. See ADR 0002.
- **No ORM.** SQL is written by hand in `services.ts` with parameterized queries. See ADR 0004.

## Known gaps and issues (honest list)
- Auth is development-only: no passwords, a new account per sign-in. A real provider is on the roadmap.
- Players' browsers download the full background image even where fog covers it (tokens and drawings
  *are* filtered server-side; the image is not).
- Fog region geometry is sent to all members (including GM "hide" shapes); only token data is filtered.
- HTTP routes have no rate limiting (realtime commands do).
- `.env.example` previously listed an unused `SESSION_SECRET`; it was removed (session tokens are random
  and stored hashed, nothing is signed).
- Asset library page, characters, journals, handouts, templates, multi-select/undo and export/import are
  tracked in docs/implementation/checklist.md and docs/implementation/roadmap.md.
