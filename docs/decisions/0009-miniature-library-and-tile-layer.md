# ADR 0009: Miniature library import and a server-authoritative tile layer

Status: proposed (2026-10-13)

## Context
We design printable miniatures and terrain (SolutionsAsService/fantasy-miniatures, scifi-miniatures, shown in
miniature-viewer) on a 1 in grid, which is the VTT's default 5 ft cell. GMs should be able to use the same pieces as
token art and build maps from the same terrain tiles, and get a print list back from a VTT map. Full plan:
[docs/integration/miniatures-and-terrain.md](../integration/miniatures-and-terrain.md).

## Decision
- Miniature packages emit VTT assets (top-down token/tile PNGs sized `footprintCells * pxPerCell`, optional GLB) and a
  versioned **library manifest** (`open-dungeon.mini-library` v1, validated by zod in `shared/library.ts`).
- Import happens **in the browser** through the existing upload endpoint (magic-byte sniffing, size limit, role check;
  ADR 0008). No server-side URL fetching in v1.
- Assets gain `source_ref` (`mini:<repo>/<id>@<revision>`) and `meta` (footprint, walls, doors). Tokens link to a
  mini through `token.assetId`; the token protocol is unchanged.
- Terrain maps use a new **`map_tiles`** table and GM-only `tile.place | tile.remove | tile.clear` commands that follow
  ADR 0006: validated, authorized, applied in a transaction, `seq`-ordered, delivered as events and in the snapshot.
  Tile footprints come from the asset's `meta`, never from the client. Square grids only in v1.
- Rendering is a `tiles` layer in the PixiJS engine between background and grid (ADR 0005).
- Interop by adoption: OpenLOCK (clip geometry imported from the user's download, not vendored) or magnets for joints;
  Universal VTT (.dd2vtt/.uvtt) and Watabou One Page Dungeon JSON for map import.

## Consequences
Small, additive steps (migration 0004 for assets, a later one for tiles); no change to token commands. v1 tiles are
visible to all players, the same layout leak as background images today, until tiles are fog-filtered. Hex terrain and
GLB uploads are out of scope until a later ADR.
