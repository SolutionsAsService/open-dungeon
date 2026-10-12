# ADR 0002: Vite + React SPA instead of Next.js

Status: accepted (2026-10-12)

## Context
The brief suggests Next.js. The product is an authenticated, interactive workspace with no SEO needs, and the realtime server must be long-lived anyway (ADR 0001).

## Decision
Vite 8 + React 19 + TypeScript + Tailwind v4, with a minimal history router (`web/src/router.tsx`). The SPA is built to `dist/` and served by the Node server; in development Vite proxies `/api` and `/ws`.

## Consequences
Simpler build and fewer moving parts; no SSR. If marketing pages are needed later they can be static files.
