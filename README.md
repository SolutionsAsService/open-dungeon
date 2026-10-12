# OPEN TABLETOP (open-dungeon)

A system-agnostic, self-hostable multiplayer virtual tabletop: a shared battle map with miniatures at the core,
for D&D-style games, narrative games and homebrew alike.

**Works today:** campaigns, sessions and invite links · PixiJS table with square/hex/gridless grids, calibration
and zoom-at-cursor · token placement, drag, rotation, HP, conditions, art, ownership, hiding and locking ·
realtime sync with reconnection and conflict handling · server-side dice (with private/GM rolls) · chat ·
turn order · measurement with waypoints · drawing and pings · manual fog of war that never leaks hidden tokens ·
pluggable rulesets (generic, d20 demo, narrative homebrew) · pause/close/reopen with full state restore.

## Quick start
```bash
npm ci
npm run dev        # http://localhost:5173
```
No database needed (embedded PGlite). See [local setup](docs/development/local-setup.md).

## Checks
```bash
npm run typecheck && npm test && npx vite build
npm run test:e2e   # Playwright two-browser MVP flow
```

## Documentation
- User: [getting started](docs/user/getting-started.md)
- Architecture: [overview](docs/architecture/system-overview.md) · [assessment](docs/architecture/repository-assessment.md) ·
  [data model](docs/architecture/data-model.md) · [realtime protocol](docs/architecture/realtime-protocol.md) ·
  [rulesets](docs/architecture/ruleset-system.md) · [security](docs/architecture/security.md) · [decisions](docs/decisions/README.md)
- Development: [local setup](docs/development/local-setup.md) · [testing](docs/development/testing.md) · [deployment](docs/development/deployment.md)
- Planning: [roadmap](docs/implementation/roadmap.md) · [resume checklist](docs/implementation/checklist.md) · [project brief](docs/PROJECT-BRIEF.md)

## Licence
No licence file has been added yet.
