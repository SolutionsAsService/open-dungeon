# Roadmap

Phases follow docs/PROJECT-BRIEF.md §25. Status reflects the code on main; the detailed, always-current list is
docs/implementation/checklist.md.

| Phase | Scope | Status |
|---|---|---|
| 0 Audit | repository assessment, baseline | done (repo was empty) |
| 1 Foundation | shell, nav, dev auth, campaigns, sessions, schema, migrations, membership/permissions, tests | done |
| 2 Tabletop | full-screen table, PixiJS engine, pan/zoom, map upload, grids, calibration, tokens, inspector, persistence | done |
| 3 Multiplayer | realtime, presence, authoritative updates, reconnection, conflicts, filtering, tests | done |
| 4 Gameplay | dice, history, measurement (paths), drawing, initiative, chat, HP/conditions | done; area templates in progress |
| 5 GM tools | fog (rect), hidden tokens, GM-only drawings, pause/close/reopen | partial: polygon/brush fog, journals, handouts, layers pending |
| 6 Rules | ruleset interfaces, demo + homebrew modules, ruleset-driven character sheets | done (ruleset editor later) |
| 7 Assets & import/export | upload pipeline | partial: asset library page, export/import, extra storage adapters pending |
| 8 Production | CI, E2E, docs | partial: real auth provider, HTTP rate limits, fog-masked backgrounds pending |

## Next, in order
1. ~~Character sheets driven by ruleset sheet sections~~ (done)
2. Journals and handouts (GM-private, shared, per-player reveal)
3. Polygon and brush fog
4. Area templates (cone, circle, line, square)
5. Multi-select and undo
6. Campaign export/import (versioned JSON)
7. Additional storage adapter (Shadw linked storage, or S3-compatible)
8. Real login (OIDC) alongside dev auth

Later: asset library page, walls/lighting/vision, fog-masked background delivery, ruleset editor, voice/video.

## Proposed: miniatures and terrain
Printable miniatures and 1 in terrain tiles as VTT assets, a library manifest import, and a tile layer for building
maps from terrain pieces: [docs/integration/miniatures-and-terrain.md](../integration/miniatures-and-terrain.md)
(ADR [0009](../decisions/0009-miniature-library-and-tile-layer.md), proposed). Phases: M0 docs + token render proof
(`tools/miniatures/render-token.ts`), M1 package assets, L1/L2 library import, T1–T5 terrain tooling, tile layer,
imports and fog filtering.
