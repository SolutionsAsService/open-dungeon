# ADR 0005: PixiJS engine separate from React

Status: accepted (2026-10-12)

## Context
The table must stay smooth with large maps, dozens of tokens and frequent moves. Re-rendering React on pointer moves would be too slow.

## Decision
`web/src/table/engine.ts` owns a PixiJS v8 `Application`: camera (translate + scale on a world container), layers (background, grid, drawings, tokens, measure, fog, fx), dirty-flag redraws per animation frame, viewport culling for the grid, and all pointer/keyboard input. It subscribes to the Zustand store; React panels never see pointer-move state.

## Consequences
Fast interaction and a clean seam for future layers (lighting, walls). Canvas interactions need inspector alternatives for accessibility (implemented for position, rotation, visibility, ownership). E2E tests use `window.__odTable` hooks to convert world to screen coordinates.
