# ADR 0011: Private miniature libraries and bring-your-own figures

Status: accepted (2026-10-13). Amends [ADR 0010](0010-3d-scene.md) ("library is bundled, not uploaded").

## Context
The real miniatures live in private repos (SolutionsAsService/fantasy-miniatures, scifi-miniatures, catalogued by
miniature-viewer); this repo is public. ADR 0010 bundled an imported copy at build time, so a public deployment either
had no real minis or published them to anyone who could load the site. Players also want to bring their own figures.

## Decision
- **Library sources, read by the server.** `MINI_LIBRARY_SOURCES` lists miniature-viewer catalogues: a folder,
  an `https://` viewer URL, or `github:Owner/repo@ref:path` (`server/minisources.ts`). GitHub is read through the
  contents API with `MINI_LIBRARY_TOKEN` (else `GITHUB_TOKEN`); the token goes only to api.github.com, never to the
  browser, logs or the repo. The server converts the catalogue with the same code as the import script (footprint,
  cells, height; meshes stripped to name, colour, vertices, triangles), caches it in memory (`MINI_LIBRARY_TTL_SECONDS`,
  default 1 h; a failed refresh keeps the old copy) and serves it to **campaign members only**:
  `GET /api/campaigns/:id/minis` and `GET /api/campaigns/:id/minis/:mini/mesh` (non-members get 404).
  Catalogue paths are normalised and may not leave the catalogue root; HTTPS sources refuse redirects.
- **Build-time option kept for static hosts.** `tools/miniatures/import-library.ts` takes the same source syntax
  (GitHub via `MINI_LIBRARY_TOKEN`/`GITHUB_TOKEN`/`GH_TOKEN` or `gh auth token`), so a Docker/Shadw build can pull
  the private minis (`--build-arg MINI_LIBRARY`, BuildKit secret `mini_library_token`). Bundled minis are public to
  anyone who can load that deployment; that is the owner's choice per deployment and documented as such.
- **Bring-your-own figures.** Members upload STL (binary/ASCII), OBJ or glTF/GLB to
  `POST /api/campaigns/:id/minis` (raw body; name, up axis, height, base size and kind in the query). `shared/meshimport.ts`
  sniffs the type, converts to the parts format (z up, mm, base on z = 0), guesses units (mm/cm/in/m from the size; glTF is
  metres) unless a height is given, and simplifies above 500 k triangles by vertex clustering on the server (no client-side
  decimation). The JSON mesh is stored through `Storage` (which gains `delete`); metadata in `uploaded_minis`
  (migration 0005), scoped to the campaign, with ids `u-<16 hex>` so tokens reference them by `miniId` like library minis.
  GMs always upload; players only if the campaign setting `player_mini_uploads` is on, and may put only their own uploads
  on tokens they control. Uploader or GM renames/deletes.
- **Facing.** Rotation 0 faces south (the bottom edge, toward the players' side of the 3D table); the 2D facing tick,
  pawns and library models (CAD front = -y) agree.
- **Client merges** bundled (sample + build-time import), then server library items, then uploads; the first id wins.
  Tokens keep referring to minis by `miniId`.

## Consequences
No public copy of private meshes is needed for a multiplayer deployment. The server needs outbound HTTPS to GitHub when a
GitHub source is configured. Local mode (static hosting, no server) has no library sources, only bundled minis.
