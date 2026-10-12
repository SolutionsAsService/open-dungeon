# ADR 0004: PostgreSQL, embedded PGlite fallback, hand-written SQL

Status: accepted (2026-10-12)

## Context
We want relational integrity, transactions and JSONB, but local development and CI should not require installing a database.

## Decision
Production uses PostgreSQL via `DATABASE_URL` (`pg` pool). Without it, the server uses PGlite (Postgres compiled to WASM) persisted at `DATA_DIR/db`; tests use in-memory PGlite. Migrations are ordered `.sql` files applied by `migrate()` on boot or `npm run db:migrate`. Queries are parameterized SQL in `services.ts`; no ORM.

## Consequences
Same SQL everywhere. PGlite is single-connection, so `db.tx` serializes transactions there. Migration files must separate statements with `;` + newline (the runner splits on that).
