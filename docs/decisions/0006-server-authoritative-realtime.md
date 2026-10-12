# ADR 0006: Server-authoritative realtime, versions and sequence numbers

Status: accepted (2026-10-12)

## Context
Several players act concurrently; the GM must keep authority; hidden information must not leak; reconnects must not duplicate actions.

## Decision
Clients send commands, never state. The hub serializes commands per session, applies each in a DB transaction with authorization, bumps a per-session `seq`, and delivers per-recipient filtered events. Tokens carry a `version`; mismatched `baseVersion` is rejected as `stale` (first writer wins). Clients keep an outbox and resend with the same `cid`, which the server de-duplicates. No CRDTs.

## Consequences
Deterministic, simple to reason about and test (`tests/integration/realtime.test.ts`). Optimistic UI is limited to token moves with rollback.
