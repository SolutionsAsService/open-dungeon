# Architecture decision records

Short records of decisions already made in the code. Add a new numbered file when a decision changes; mark the old one superseded.

| # | Decision |
|---|---|
| [0001](0001-modular-monolith.md) | One Node process: HTTP API + WebSocket + static SPA |
| [0002](0002-vite-react-spa.md) | Vite + React SPA instead of Next.js |
| [0003](0003-dev-auth.md) | Development auth first, behind a replaceable boundary |
| [0004](0004-postgres-pglite-sql.md) | PostgreSQL with embedded PGlite fallback; hand-written SQL migrations |
| [0005](0005-pixijs-engine.md) | PixiJS canvas engine separate from React |
| [0006](0006-server-authoritative-realtime.md) | Server-authoritative realtime with versions and sequence numbers (no CRDT) |
| [0007](0007-ruleset-modules.md) | Game systems as validated TypeScript modules |
| [0008](0008-storage-interface.md) | Object storage behind a small Storage interface |
| [0009](0009-miniature-library-and-tile-layer.md) | Proposed: miniature library import and a server-authoritative tile layer |
