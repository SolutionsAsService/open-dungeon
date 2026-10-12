# ADR 0001: Modular monolith on one Node server

Status: accepted (2026-10-12)

## Context
The table needs permanent WebSocket connections, an authoritative ordering of commands per session, and must be easy to self-host for a small group. Serverless platforms cannot hold WebSockets.

## Decision
A single Node process (`server/main.ts`) serves the REST API, the `/ws` WebSocket endpoint and the built SPA. Modules are separated by file (services, hub, storage, db) rather than by service. No framework: a ~20-line router in `server/app.ts`.

## Consequences
One thing to deploy and run (`npm start`). Rooms live in memory, so horizontal scaling would need sticky sessions or a shared pub/sub — acceptable for the target (1 GM + 4–8 players per table). Database and storage remain independently configurable.
