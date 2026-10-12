# ADR 0008: Object storage behind a Storage interface

Status: accepted (2026-10-12)

## Context
Uploaded maps and art should not live in the database, and deployments differ (local disk, S3-compatible, user storage).

## Decision
`server/storage.ts` defines `Storage { put(key, data); get(key) }` with `LocalDiskStorage` (keys validated, under `DATA_DIR/uploads`) and `MemoryStorage` for tests. Keys are server-generated asset ids.

## Consequences
Other backends implement the same two methods; metadata stays in the `assets` table.
