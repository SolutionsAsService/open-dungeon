# ADR 0010: A 3D table (three.js) over the same tokens, with a miniature library

Status: accepted (2026-10-13). Amends [ADR 0009](0009-miniature-library-and-tile-layer.md) and
[ADR 0005](0005-pixijs-engine.md).

## Context
The owner wants a table where the printable 3D miniatures (SolutionsAsService/fantasy-miniatures, scifi-miniatures,
catalogued by miniature-viewer) can be dropped in and played with. ADR 0009 planned top-down token PNGs and a tile
layer; it put "GLB uploads and a 3D view" off to later. The miniature viewer already renders the same models with
three.js from `viewer/<id>.parts.json` (mm, z up).

## Decision
- **A second renderer, not a second state.** `web/src/table/scene3d.ts` (three.js, OrbitControls) draws the same
  Zustand store as the PixiJS engine: map, grid, fog, tokens. It is lazy-loaded when a user switches a scene to 3D
  (2D/3D toggle per scene, remembered per browser), so the 2D bundle does not grow. PixiJS stays the 2D engine.
- **Real scale.** World units are millimetres; one grid cell is 25.4 mm (1 in = 5 ft at 28 mm heroic scale,
  `shared/minis.ts`), so a printed model and its 3D twin are the same size relative to the grid.
- **Tokens are shared.** A 3D figure is an ordinary token row; moving or turning it sends `token.move` /
  `token.update` (rotation = facing) through the existing server-authoritative path (ADR 0006), so 2D and every other
  player follow. The only protocol change is `TokenView.miniId` (migration 0004), set on `token.create` or by
  GM-only `token.update`; `token.create` also accepts `locked` for scenery.
- **Library is bundled, not uploaded (v1).** `tools/miniatures/import-library.ts` copies the viewer catalogue into
  `web/src/minis/library.json` (bundled index, zod `MiniLibrary`) and `public/minis/<id>.parts.json` (only name,
  colour, vertices, triangles). Static files from our own origin: no new upload or fetch trust boundary. The imported files are git-ignored because this repo is public and the fantasy designs are private; a
  committed sample library (two simple pieces) keeps clean checkouts working. This replaces
  ADR 0009's PNG-asset import for 3D; the PNG path and the tile layer stay valid for 2D and remain proposed.
- **Scenery = locked object tokens.** Terrain pieces (tower, well, treasure) are tokens with `category: 'object'`,
  `locked: true` and a `miniId`, so they reuse ordering, permissions, fog filtering and deletion.
- **Footprint from the model.** Base size is the ground-contact box of the mesh; 25/32/40 mm bases snap to one square,
  larger ones to the nearest whole squares, at least 2 x 2 (`cellsForBase`).

## Consequences
Small protocol change, one migration, no new server endpoints. The 3D view shows fog as a dark sheet; players still
receive only the tokens the server lets them see. Costs: three.js (~600 kB, lazy chunk); headless tests need WebGL
(SwiftShader). Not yet: user-uploaded GLB/parts files (needs a sniffing/size policy, see ADR 0009), hex terrain,
measuring and drawing tools in 3D.
