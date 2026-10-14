# The 3D table

Status: built (ADR [0010](../decisions/0010-3d-scene.md)). The owner's goal: a 3D table you can drop the printable
miniatures onto, shared live with the 2D map and other players.

## Use it
- **Switch a scene to 3D** with the **2D | 3D** toggle at the top right of the table. The choice is remembered per scene
  in this browser; other players choose their own view of the same tokens.
- **Camera:** left-drag orbits, right-drag pans, wheel zooms, **F** (or the toolbar's fit button) frames the board.
- **Tokens:** left-drag a token you may move (snaps to the grid by its size); **arrow keys** step the selected token a
  square; **Q / E** turn it 45 degrees (that is the token's rotation, so the 2D facing tick turns too). The inspector
  works as in 2D. Ping and token tools work on the 3D board.
- **Miniatures:** open the **Minis** tab in the side panel. GMs drag an entry onto the table (2D or 3D) or press
  **Place** (map centre). Figures become normal tokens; scenery (tower, well, treasure) becomes a locked object token.
  The inspector's **3D miniature** picker swaps a token's model or turns it back into a plain pawn.
- **Walls and rooms:** there is no wall layer yet, so the 3D view stands drawings up as 1.5 in (38 mm) stone walls:
  lines (not arrows), the four sides of rectangles (rooms) and freehand paths. Circles and text stay flat. Toggle with
  **Walls** next to the 2D | 3D switch (remembered per browser). Players only get walls in areas revealed from fog.

## Scale
World units are millimetres; one grid cell is 25.4 mm (1 in = 5 ft at 28 mm heroic scale). Models are shown at their
real print size, so a 25 mm based figure fills one square and the wizard tower stands 204 mm tall. Base size comes from
the mesh's ground contact: up to 42 mm (25/32/40 mm bases) = 1 square, larger = the nearest whole number of squares,
at least 2 x 2 (`cellsForBase` in `shared/minis.ts`).

## Private library and uploads
See ADR [0011](../decisions/0011-private-minis-and-uploads.md): the server can read private viewer catalogues
(`MINI_LIBRARY_SOURCES`) and members can upload STL/OBJ/glTF figures (`shared/meshimport.ts`, Minis tab → Upload).

## Library import
```bash
npx tsx tools/miniatures/import-library.ts ../miniature-viewer
```
reads `data/catalog.json` and each `assets/minis/<id>/viewer/<id>.parts.json`, then writes
`web/src/minis/library.json` (bundled index: id, name, family, figure/scenery, footprint, cells, height, source repo) and
`public/minis/<id>.parts.json` (name, colour, vertices, triangles only; print, STL and notes fields dropped). Re-run when
the viewer registers new minis. Families matching terrain/scatter/building/scenery are scenery.

**Privacy:** this repo is public, while fantasy-miniatures and miniature-viewer are private. The imported
`library.json` and meshes are therefore git-ignored and only exist on the machine that ran the import (and in builds
made there). The repo ships `web/src/minis/library.sample.json` with two simple pieces (a pillar and a crate,
`public/minis/sample-*.parts.json`) so the feature works from a clean checkout. Publishing the real minis needs the
owner's decision (make the meshes public, or build/deploy from a private checkout).

## How it fits
- `web/src/table/scene3d.ts` is a second renderer over the same Zustand store as the PixiJS engine (lazy chunk).
  Map px (x, y) become world (x, z) mm; model z-up becomes world y-up with model +y pointing north (map up), so a
  model's front (CAD -y) faces south — toward the players' edge — at rotation 0. Pawns and the 2D facing tick agree.
- Board: wooden table, ground from the map's background image or a flagstone texture with one stone per cell, grid
  lines (square or hex), a dark fog sheet (GMs see it at 50 %), hemisphere + shadowed sun light.
- Only protocol change: `miniId` on tokens (migration `0004_token_mini.sql`), plus `locked` on `token.create`.

## Tests
`tests/unit/minis.test.ts` (scale, base snapping, footprint, schema), `tests/unit/import-library.test.ts` (import,
bundled library, placement snapping), `tests/integration/realtime.test.ts` (miniId and facing sync, GM-only model
swap, locked scenery, invalid ids). Visual check: headless Chrome with SwiftShader WebGL (see
docs/development/testing.md).

## Not yet
A real wall layer (walls/vision roadmap; also UVTT import) to replace drawings-as-walls; doors. Measuring, drawing and fog painting in 3D (switch to 2D); hex-shaped bases; token art in 3D;
pings are sent but not drawn in 3D.
