# Implementation checklist (resume here)

Spec: docs/PROJECT-BRIEF.md. Commit as SolutionsAsService <152567394+SolutionsAsService@users.noreply.github.com>; push to main in small working steps; run npm run typecheck && npm test && npx vite build before each push.

## Stack (see ADRs once written)
Vite + React 19 + TS + Tailwind v4 client (web/src), PixiJS v8 table engine (web/src/table/engine.ts), Zustand store, single Node server (server/) serving HTTP API + WebSocket (ws) + built SPA, PostgreSQL via DATABASE_URL or embedded PGlite (DATA_DIR/db) with SQL migrations (server/db/migrations), local-disk storage behind Storage interface, zod schemas in shared/.

## Done
- [x] Phase 0: repo was empty (README only); foundation established
- [x] shared/grid.ts — square/hex(pointy,flat)/gridless, snapping, diagonal rules, units (tests/unit/grid.test.ts)
- [x] shared/dice.ts — constrained parser (kh/kl/dh/dl, d%), limits, CSPRNG (tests/unit/dice.test.ts)
- [x] shared/permissions.ts — roles & capabilities; shared/fog.ts — ordered reveal/hide regions
- [x] shared/protocol.ts — validated realtime commands + server event types
- [x] shared/rules — RulesetModule contract + generic, d20-fantasy (demo), stress-and-story (homebrew, no initiative/HP)
- [x] server: schema 0001_init.sql, services.ts (all authz server-side), hub.ts (ordered rooms, per-recipient filtering of hidden/fogged tokens, GM-only drawings, private rolls, hidden combatants; dedupe by cid per user per room; rate limiting), app.ts (REST + CSRF header + WS origin/membership checks), dev auth (cookie, hashed tokens)
- [x] uploads: magic-byte sniffing (PNG/JPEG/WebP/GIF), size limit, member-only retrieval; SVG intentionally rejected
- [x] tests/integration/services.test.ts + realtime.test.ts (two real WS clients: sync, stale-move conflicts, dedupe, fog/hidden leaks, reconnect)
- [x] web: sign-in, dashboard, campaign page (sessions, invites), invite accept, settings (theme/text size), rulesets page
- [x] tabletop: top bar (connection/save status, players, GM pause/close/reopen, fullscreen), toolbar (select, pan, measure, draw, erase, ping, token, fog; hotkeys), contextual tool options, canvas (camera zoom-at-cursor, fit, culling grid, background image, tokens w/ art/HP/conditions/facing, drawings, fog texture, ruler, pings), inspector (position/rotation/size/HP/conditions/colour/art/owners/hidden/locked/duplicate/add to turns/delete), chat with /r, dice bar with ruleset presets, turn order, party, map setup wizard
- Test hooks: window.__odTable.worldToScreen(p); data-testid: table-canvas, session-name, conn-status, session-status, inspector, chat-log, roll-total, initiative-list, invite-link; toolbar buttons have data-tool.

## Next
- [x] Playwright E2E (playwright.config.ts, tests/e2e/mvp.spec.ts): two browser contexts run the spec's 15-step MVP flow. Local browsers: ~/.cache/ms-playwright (chromium-1248); may need LD_LIBRARY_PATH=$HOME/.cache/pwlibs/root/usr/lib/x86_64-linux-gnu
- [x] GitHub Actions CI (typecheck, unit+integration, build, e2e) — green on main (run 38318542531, 2026-10-12)
- [ ] Docs: architecture/{repository-assessment, system-overview, data-model, realtime-protocol, ruleset-system, security}.md, decisions/ ADRs, implementation/roadmap.md, development/{local-setup, testing, deployment}.md, user/getting-started.md, README
- [ ] Then: characters + sheets (rulesets' sheet sections), journals/handouts, polygon/brush fog, area templates, multi-select/undo, campaign export/import, asset library page, S3 storage adapter, real auth provider, fog-masked background for players (known limitation: players' client downloads the full background image)
