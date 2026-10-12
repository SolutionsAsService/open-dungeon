# Testing

| Command | What runs |
|---|---|
| `npm run typecheck` | `tsc --noEmit` over shared, server, web, tests |
| `npm test` | Vitest: `tests/unit` (grid, dice, fog, permissions, rulesets) and `tests/integration` (services with in-memory PGlite; realtime with a real HTTP server and two `ws` clients) |
| `npx vite build` | production bundle |
| `npm run test:e2e` | Playwright: builds, starts the server on :8790 with a fresh `.data-e2e`, runs `tests/e2e/*.spec.ts` in Chromium |

Run all three of typecheck, test and build before pushing; CI (`.github/workflows/ci.yml`) runs them plus E2E on every push to main and on PRs.

## Playwright locally
`npx playwright install chromium` once. On minimal Linux/WSL without system libraries, install them with
`npx playwright install-deps chromium` (needs sudo) or point `LD_LIBRARY_PATH` at extracted libraries.
The E2E flow (`tests/e2e/mvp.spec.ts`) uses two separate browser contexts (GM and player) and covers the brief's
MVP acceptance list: campaign/session creation, map upload, grid config, tokens, invite, shared moves, independent
cameras, measurement, shared dice, initiative, fog secrecy (including a direct snapshot fetch), close and reopen.

Test hooks: `window.__odTable` exposes `worldToScreen`, `camera`, `state`; stable `data-testid`s are listed in the checklist.

## Writing tests
- Domain rules → `tests/integration/services.test.ts` style: call `Services` directly with several users and assert
  both success and refusal (`rejects.toMatchObject({ code: 'forbidden' })`). Assert secrets are absent from
  `JSON.stringify(snapshot)`.
- Realtime → `tests/integration/realtime.test.ts`'s `Client` helper (connect, send with cid, waitFor).
- Pure logic → `tests/unit`.
