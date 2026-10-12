# ADR 0003: Development auth first, behind a replaceable boundary

Status: accepted (2026-10-12)

## Context
Phase 1 needed accounts and memberships for permissions and multiplayer tests without depending on an external identity provider or credentials.

## Decision
`POST /api/auth/dev` creates a user from a display name and issues an opaque 256-bit session token in an HttpOnly cookie; the database stores only its SHA-256. Everything else only uses `Services.userForToken(cookie)`, so a real provider just has to create/find a user and issue the same session.

## Consequences
No passwords or recovery: dev auth must be disabled or restricted in public deployments once a real provider exists. Tests and local play stay credential-free.
