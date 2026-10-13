# Miniatures, terrain and open-dungeon

Status: **proposed** (see [ADR 0009](../decisions/0009-miniature-library-and-tile-layer.md)). Written 2026-10-13 against
main at e4790d4. Nothing here is built except the proof in §6.

The idea: one design source, two tables. Each physical miniature or terrain piece we design (in
SolutionsAsService/fantasy-miniatures and scifi-miniatures, shown in miniature-viewer) also produces the assets
open-dungeon needs. The GM can then build the same dungeon on the VTT and on the kitchen table, and print a parts list
from the VTT map.

## 1. One grid for both tables

| | Physical | open-dungeon |
|---|---|---|
| One square | 1 in = 25.4 mm | one cell, `GridConfig.cellSize` px (default 70), `unitsPerCell: 5`, `unit: 'ft'` |
| Figure scale | 28 mm heroic: `miniature_scale_convert` / `scale_ratio('28mm')` gives 1:59.5 (feet to eyes) | n/a |
| Check | 5 ft = 1524 mm / 59.5 = 25.6 mm, within 1 % of 1 in | default grid already means 5 ft cells |

So the default VTT grid and a 1 in terrain grid are the same thing. Footprints are always whole cells:
a 25 mm round base is 1 x 1, a 50 mm base 2 x 2, a 60 x 50 mm cottage 2 x 2 (snapped by `terrain_grid_check`).
Hex grids: tokens work as today; terrain tiles are square-only in v1 (see risks).

## 2. Terrain system for printable miniatures

### 2.1 Adopt, don't invent
- **Connectors: OpenLOCK** (Printable Scenery). Free, widely printed, 1 in grid, clip slots in a 6 mm base, one slot
  centred on each cell edge. Existing tiles from the community then join ours. We do **not** redraw or vendor the clip:
  the build script imports the published clip-socket geometry from a path the user downloads (their terms apply; check
  them before we redistribute any STL that contains the socket). `miniature_terrain_grid_check(connector="openlock")`
  already checks the 6 mm base and grid and returns the slot positions.
- **Alternative joint: 5 x 2 mm magnets**, for people who don't want clips. Same tool, `connector="magnet"`: pocket
  5.2 x 2.1 mm, centre 3.8 mm in from the edge, one per cell edge, alternate polarity. Measured today for a 2 x 2 tile:
  6 mm base leaves a 3.9 mm pocket floor, a 4 mm base still leaves 1.9 mm (limit 0.45 mm FDM); all checks pass.
- **Plain** (no connector) for scatter and for loose dungeon tiles on a mat.
- **Map sources:** Watabou One Page Dungeon (JSON export of rooms, doors and notes; also opens in Dungeon Scrawl) and
  the **Universal VTT** format (`.dd2vtt` / `.uvtt`, exported by Dungeondraft, DungeonFog, Arkenforge, AutoWall; a
  base64 image plus `resolution { map_origin, map_size, pixels_per_grid }`, `line_of_sight` wall polylines,
  `portals` (doors) and `lights`, all in grid units). We read these instead of building a map editor first.

### 2.2 Sets (v1)
Print process: terrain is **FDM-first** (0.4 mm nozzle, 0.2 mm layers, no supports: 45 deg chamfers, recessed
detail >= 0.6 mm), scatter and fine details resin. All pieces carry a `vtt` block (§3.1) with their footprint, edges and
wall segments in cell units, so the VTT knows what each piece blocks.

**Dungeon (fantasy-miniatures, family "Terrain & Scatter")**
| Piece | Cells | Notes |
|---|---|---|
| Floor, flagstone | 1x1, 2x1, 2x2, 4x2 | 6 mm OpenLOCK base, stone joints 0.8 mm wide/0.6 mm deep (`detail_advice(kind="plank_joint")`) |
| Wall, straight | 1, 2 (edge) | wall on the cell **edge** (straddles the grid line, 8 mm thick), 2 in high so hands reach in; matches VTT/uvtt walls, which are cell-edge segments |
| Corner post | intersection | covers wall joints; outer L, inner L, T, X variants |
| Door, single | 1-cell edge | 21 x 40 mm opening: `floor_clearance_check(door_mm=[21,40])` passes (min 17.5 wide, 33.1 high for a 28 mm figure on its base), but a 25 mm base does not physically pass; the figure is lifted through |
| Door, double | 2-cell edge | 44 mm clear opening for corridors where bases must pass; hinged or lift-out leaf |
| Pillar, rubble, stairs-down hatch | 1x1 | scatter-class, plain base |

**Sci-fi corridor (scifi-miniatures)**
| Piece | Cells | Notes |
|---|---|---|
| Corridor straight | 2x2 | 2-cell-wide corridor, deck grating as recessed panels (no through-holes), walls chamfered 45 deg inward at the top (prints without supports) |
| Junction L / T / X, dead end | 2x2 | same edge profile so any piece meets any piece |
| Bulkhead + sliding airlock | 2-cell edge | door leaf slides in a slot (slip fit from `PROCESSES`), 44 mm clear |
| Room floor | 2x2, 4x4 | plain deck, OpenLOCK or magnet |
| Consoles, crates, barrels, conduits | 1x1, half-cell | scatter, resin or FDM |

**Scatter** (both lines): barrels, crates, chests (treasure-scatter exists), rubble, consoles. Footprint snapped to 1 or
1/2 cell, plain base, appear in the VTT as tokens of category `object`.

### 2.3 Tooling to add (unified-CAD-MCP + 3dada)
Already there (`src/unified_cad_mcp/miniature.py`, `miniature_more.py`): `terrain_grid_check` (grid snap + magnet/OpenLOCK
connector positions), `base_catalog`, `floor_clearance_check`, `detail_advice`, `split_plan`, `plate_pack`,
`printability_check`, `support_plan`, `hollow_plan`, `base_and_peg`. Gaps, smallest first:

1. **`miniature_terrain_edge_check`** (read-only, pure Python): given two tiles' `vtt.edges` descriptors (floor height,
   wall height/thickness, connector type and positions, magnet polarity), say whether they join. Run it over a whole set
   in each set's `check.py`, so a set cannot ship with a piece that doesn't meet its neighbours.
2. **`miniature_terrain_bom`** (read-only): from a list of placed tiles (the VTT tile layer, §4.4, or a Watabou/uvtt
   import) count pieces per id and call `plate_pack` for plates and filament. This is the "print this map" button.
3. **`freecad_terrain_tile`** (worker, writes geometry): parametric tile (cells, base height, floor recipe, edge walls,
   door cut, connector) to STEP + STL + `vtt` block. Imports the OpenLOCK socket from a user-supplied file. One generator
   for the dungeon and sci-fi floors and walls; sculpted detail (stone texture, rubble) stays in the sculpt pipeline.
4. **`miniature_vtt_assets`**: parts.json/STL to token or tile PNG (+ GLB). The proof in §6 is the TypeScript reference;
   port it, or call it, from `fantasy-miniatures/tools/minikit.py` so every package build emits the assets.
5. **3dada `references/miniatures-lessons.md`**: add a "Terrain" section: grid first; walls on cell edges; the door
   versus base conflict; FDM orientation and chamfers; every piece declares edges; run edge check + BOM before publishing.

## 3. Asset pipeline (miniature repos)

### 3.1 Package additions (in the miniature repos, not here)
```
<id>/vtt/<id>.token.png    # minis and scatter: square, transparent, footprintCells * pxPerCell px, centred on the plan bbox
<id>/vtt/<id>.tile.png     # terrain: top-down at pxPerCell, transparent outside the piece, north = model +y
<id>/vtt/<id>.glb          # optional, for a future 3D view; same mm units, z up converted to glTF y up
```
and a `vtt` block in `mini.json`:
```json
"vtt": {
  "kind": "token",                 // token | tile | scatter
  "footprintCells": [1, 1],
  "pxPerCell": 140,                // 2x the default cellSize so tokens stay sharp at 200 % zoom
  "token": "vtt/hooded-wanderer.token.png",
  "tile": null,
  "glb": "vtt/hooded-wanderer.glb",
  "category": "pc",                // a TokenCategory from shared/protocol.ts
  "walls": [],                     // tiles: [[x1,y1,x2,y2], ...] in cell units from the tile's top-left
  "doors": [],                     // tiles: [{ "from": [x,y], "to": [x,y], "kind": "single" }]
  "edges": null                    // tiles: per-side descriptor for miniature_terrain_edge_check
}
```
Tests in each package's `check.py`: PNG is `footprintCells * pxPerCell` square, corners transparent, centre opaque;
`walls` lie inside the footprint; the miniature viewer's `register-minis.py` copies `vtt/` and passes `vtt` through.

### 3.2 Library manifest (what open-dungeon imports)
The viewer's `data/catalog.json` is already a list of models with `source { repo, path }` and downloads. Rather than a
second registry, the viewer build also writes **`data/vtt-library.json`** (a projection of the catalog) and each
miniature repo attaches the same file plus PNGs to a GitHub release (immutable, versioned URLs):
```json
{
  "format": "open-dungeon.mini-library", "version": 1,
  "name": "Fantasy miniatures", "homepage": "https://github.com/SolutionsAsService/fantasy-miniatures",
  "items": [{
    "id": "fantasy-miniatures/hooded-wanderer", "name": "Hooded Wanderer", "family": "Heroes", "revision": "0.1",
    "kind": "token", "category": "pc", "footprintCells": [1, 1],
    "token": { "url": "vtt/hooded-wanderer.token.png", "sha256": "…", "width": 140, "height": 140 },
    "tile": null, "glb": null, "walls": [], "doors": [],
    "license": "…", "attribution": "SolutionsAsService",
    "viewer": "https://…/miniature-viewer/#hooded-wanderer",
    "source": { "repo": "SolutionsAsService/fantasy-miniatures", "path": "hooded-wanderer", "commit": "ba5fe3f" }
  }]
}
```
URLs are relative to the manifest. `license` and `attribution` are required because open-dungeon's `assets` table
already has those columns and the brief forbids unattributed content.

## 4. open-dungeon changes

Principles from the ADRs: clients send commands, the server validates (zod), authorizes (`shared/permissions.ts`),
persists in one transaction, bumps `seq` and sends filtered events (ADR 0006); binaries go through `Storage` with
server-generated keys and magic-byte sniffing (ADR 0008); rendering stays in the PixiJS engine (ADR 0005).

### 4.1 Import a library (no new trust boundary)
v1 imports **in the browser**: the GM opens the asset library, pastes a manifest URL (or picks a downloaded file),
ticks items, and the client fetches each PNG and uploads it through the existing
`POST /api/campaigns/:id/assets` (`sniffImage`, size limit, `map.edit`/`token.create` check). No server-side fetch,
so no SSRF surface. A later server-side importer, if wanted, needs a host allowlist (`github.com`,
`objects.githubusercontent.com`, `*.github.io`), redirects re-checked, size and count limits.
Works in the static-host local mode too, since it only uses the existing upload call.

### 4.2 Link assets to a mini id
Migration `0004_asset_source.sql`: `assets.source_ref TEXT` (`mini:<repo>/<id>@<revision>`) and `assets.meta JSONB`
(the item's `kind`, `footprintCells`, `walls`, `doors`, `sha256`). The upload route accepts
`license`, `attribution`, `source_ref` and `meta` (validated by a zod `LibraryItemMeta` in `shared/library.ts`; the
asset's sniffed width/height must equal `footprintCells * pxPerCell`). Re-importing the same `source_ref` reuses the
asset (dedupe by `sha256`).

**Tokens need no protocol change**: a token links to its mini through `token.assetId` → asset → `source_ref`. Placing
from the library sends the existing `token.create` with `assetId` and `size = footprintCells[0]`; the engine already
draws art masked to a circle of `size * cellSize`, which matches a round base. The inspector shows "View miniature"
(the manifest's `viewer` URL) when the asset has a `source_ref`.

### 4.3 Library manifest schema
`shared/library.ts`: zod `MiniLibrary` for §3.2 (format literal, version 1, ≤ 2000 items, ids ≤ 64 chars,
footprint 1–10 cells matching `TokenPatch.size`, relative or https URLs only, walls inside the footprint).
Unit-tested against a fixture manifest.

### 4.4 Tile layer (map building from terrain pieces)
Static map state, like `maps`, separate from hot token state:
```sql
CREATE TABLE map_tiles (
  id TEXT PRIMARY KEY, map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id), col INTEGER NOT NULL, row INTEGER NOT NULL,
  rot SMALLINT NOT NULL DEFAULT 0 CHECK (rot IN (0, 90, 180, 270)),
  layer TEXT NOT NULL DEFAULT 'floor' CHECK (layer IN ('floor', 'wall', 'scatter')),
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX map_tiles_map ON map_tiles(map_id);
```
Protocol (`shared/protocol.ts`), GM-only (`map.edit`), square grids only:
```ts
{ type: 'tile.place', assetId: Id, a: z.number().int(), b: z.number().int(), rot: z.union([0, 90, 180, 270]), layer }
{ type: 'tile.remove', id: Id }
{ type: 'tile.clear', layer?: ... }
// events
{ type: 'tile.added'; tile: TileView } | { type: 'tile.removed'; ids: string[] }
// SessionSnapshot gains tiles: TileView[]   (TileView = { id, assetId, a, b, rot, layer, w, h })
```
The server takes `w, h` from the asset's `meta.footprintCells` (never from the client), rejects placements on hex or
gridless maps, caps tiles per map (e.g. 4000) and bumps `seq` like other commands. Tile ops are add/remove only, so
they need no version field; ordering comes from `seq`.

Engine: a `tiles` container between `background` and `grid`, one sprite per tile from the existing texture cache,
rotated about the tile centre, culled like the grid. Toolbar: the brief's "paint terrain" tool (pick a tile, click to
place, R to rotate, right-click to remove).

**Visibility:** in v1 tiles go to everyone, which leaks the layout under fog exactly as the background image already
does (known limitation in the checklist). Phase T3 filters tiles per recipient with the same fog test used for tokens.

**Walls:** a tile's `meta.walls` rotated and translated into world space are the seed of the roadmap's
walls/vision layer. Derive them on read; don't store a second copy.

### 4.5 Imports and exports
- **Universal VTT (.dd2vtt/.uvtt) import** (client-side, GM): decode `image` → upload as background asset; set
  `grid.cellSize = resolution.pixels_per_grid`, map size from `map_size`; keep `line_of_sight`/`portals` in the map
  for when walls exist. Fully compatible with the existing map and grid model.
- **Watabou One Page Dungeon JSON → tiles**: rooms → floor tiles (greedy cover with 4x2/2x2/2x1/1x1), room edges → wall
  tiles, doors → door tiles. The same placement list feeds `miniature_terrain_bom`.
- **"Print this map"**: export the tile layer as `{ items: [{ sourceRef, count }] }` for `miniature_terrain_bom`.
- **GLB**: the upload path accepts images only (`sniffImage`). A 3D view would add `model/gltf-binary` sniffing
  (`glTF` magic, version 2, length check) and its own size limit. Not in v1.

## 5. Phased roadmap
Each step is small, shippable and tested; the open-dungeon steps follow the checklist's push rule
(`npm run typecheck && npm test && npx vite build`).

| Phase | Repo | Step | Tests |
|---|---|---|---|
| M0 | open-dungeon | this doc, ADR 0009 (proposed), token render proof | `tests/unit/render-token.test.ts` |
| M1 | miniature repos + viewer | `vtt` block, token PNGs for the 4 fantasy minis, `vtt-library.json` written by the viewer build | package `check.py` PNG asserts; viewer test that the library validates |
| L1 | open-dungeon | `shared/library.ts` schema + client import into the asset library via the existing upload | unit (schema, fixture), e2e: import a fixture manifest, place a token, art shows |
| L2 | open-dungeon | migration 0004 `source_ref`/`meta`, place-from-library sets size, inspector "View miniature" | integration: upload with meta, size mismatch rejected, dedupe |
| T1 | unified-CAD-MCP | `miniature_terrain_edge_check`, `miniature_terrain_bom` | pytest with fixture tiles |
| T2 | fantasy/scifi-miniatures | dungeon v1 (floor, wall, corner, door) and sci-fi corridor v1 via `freecad_terrain_tile`; test print a tolerance coupon and one OpenLOCK join | printability + edge check per piece |
| T3 | open-dungeon | `map_tiles` + `tile.*` commands + engine tile layer + paint tool | integration (player forbidden, hex rejected, footprint from asset), realtime (two clients see tiles), e2e |
| T4 | open-dungeon | Universal VTT import; Watabou JSON → tiles; tile-layer export → BOM | unit (parsers on fixtures), e2e import |
| T5 | open-dungeon | fog-filtered tiles; walls from tile segments feed the walls/vision work | realtime leak tests like the token ones |
| later | | GLB uploads and a 3D view; hex terrain | |

## 6. Proof shipped with this doc
`tools/miniatures/render-token.ts` renders a top-down token PNG from a `viewer/<id>.parts.json` with a transparent
background. The footprint comes from the ground contact (vertices within 1 mm of the lowest z, so roofs, staffs and
cloaks don't widen it), rounded up to whole 1 in cells past a 2 mm tolerance; the image is cells × `--px-per-cell`
(default 140) square, centred on that contact. `--max-z` cuts the model at a height (roof off) for building and wall
tiles seen as a floor plan.
```bash
npx tsx tools/miniatures/render-token.ts ../fantasy-miniatures/hooded-wanderer/viewer/hooded-wanderer.parts.json /tmp/hooded-wanderer.png
npx tsx tools/miniatures/render-token.ts ../fantasy-miniatures/wizard-tower/viewer/wizard-tower.parts.json /tmp/tower-plan.png --max-z 20
```
Run on the four fantasy packages (2026-10-13): hooded-wanderer 1 cell (140 px), village-well 2 (280 px),
treasure-scatter 2 (280 px), wizard-tower 4 (560 px). Looked at: the wanderer reads as a hooded figure on a rocky
base, the well as a plank roof on a stone ring, the scatter as chest, barrel, crate and shield; the tower from above is
its cone roof (correct, but a poor token; buildings want the `--max-z` plan or a 3/4 view).

It is z-buffered orthographic rasterization with Lambert shading and part colours, 2x supersampled, no dependencies
(`node:zlib` for the PNG). `tests/unit/render-token.test.ts` checks footprint snapping, the roof-overhang rule,
transparency, top-most part wins, the `--max-z` cut, and that the server's `sniffImage` accepts the PNG. It is a
reference implementation for M1, not part of the app bundle.

## 7. Risks and open questions
- **OpenLOCK terms.** Free to use, but the clip/socket geometry is Printable Scenery's; import it from the user's
  download, don't commit it, and confirm their terms before publishing STLs that contain it. Magnet joints are the
  fallback with no third-party geometry.
- **Base versus cell.** A 25 mm base in a 25.4 mm cell leaves 0.2 mm per side; walls on the cell edge eat 4 mm of each
  neighbouring cell. Tight, but it is how most dungeon terrain works; doors that bases must pass are 2-cell.
- **Scale drift.** Our figures are 1:56–1:59.5; terrain at 1 in = 5 ft is about 1:60. Fine for heroic scale; say so in
  each set.
- **Render quality.** A top-down render is only as good as the model: the current fantasy minis are built from
  primitives and look like it from above. Tokens from sculpted figures, or a painted-photo token, will read better.
- **Hidden information.** v1 tiles leak layout under fog, same as the background today; fixed in T5.
- **Hex grids.** Terrain is square-only; hex tiles would need hex-footprint tiles and connectors (none open that we know of).
- **Asset limits.** `MAX_UPLOAD_BYTES` (20 MB) is plenty for 140 px/cell PNGs; a 4x4 tile at 140 px/cell is 560 px.
- **Manifest drift.** Pin manifests to a release tag or commit, record `source.commit` and `sha256`, so a re-import is
  reproducible and a changed model shows up as a new revision.
