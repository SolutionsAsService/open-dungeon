# Getting started

## As a game master
1. **Sign in** with the name you want at the table.
2. **Create a campaign**: give it a name and pick a game system (Generic, d20 Fantasy demo, or the Stress & Story
   homebrew example). The system decides default distances, conditions, quick rolls and whether there is turn order.
3. **Start a session** from the campaign page ("New session"). The table opens.
4. **Set up the map** (top bar → Map setup): upload a PNG/JPEG/WebP/GIF, choose square, hex or gridless,
   drag the cell size slider and offsets until the grid lines up, and set the scale (e.g. 1 cell = 5 ft).
5. **Place tokens** with the token tool (T): type a name, pick a category and colour, click the map.
   Select a token to open the inspector: rename, resize, rotate, set HP and conditions, upload art,
   assign it to players, hide it, lock it, duplicate, add it to the turn order or delete it.
6. **Characters**: on the campaign page (or the table's Sheets tab) create PCs and NPCs. The sheet's sections come from
   the game system. Assign a character to a player with "Played by"; link it to a token in the inspector
   ("Character sheet") so anyone allowed can open it from the map.
7. **Invite players** from the campaign page: create an invite link (valid 7 days) and send it.
8. **Fog of war** (G): "Cover map in fog", then drag rectangles to reveal or hide. Players never receive tokens
   in fogged areas unless they own them.
9. **Pause / Close / Reopen** from the top bar. Everything is saved continuously; the next session resumes the map.

## As a player
1. Open the invite link, choose your name, press **Join campaign**, then **Join table**.
2. Drag your own tokens (the GM assigns them). Arrow keys move the selected token one cell.
3. **Measure** (M): drag; Shift+click adds waypoints; right-click or Esc clears.
4. **Roll**: dice bar at the bottom, or type `/r 2d6+3` in chat. Choose Public, To GM or Private.
5. **Your character**: create one on the campaign page or in the Sheets tab, or open the one your GM assigned.
   Fields save when you leave them.
6. **Ping** (P) to point at something; **Draw** (D) to sketch; **Erase** (E) your own drawings.

## Miniatures and the 3D table
- Switch a scene to **3D** with the 2D | 3D toggle (top right). Open the **Minis** tab in the side panel.
- **GM:** drag a miniature onto the table (or press **Place**). Figures snap by their base size; scenery is placed locked.
- **Your own figures:** press **Upload figure (STL, OBJ, GLB)** in the Minis tab, give it a name and press Upload.
  - Files up to 20 MB: STL (binary or text), OBJ, GLB, or .gltf with embedded data. Draco-compressed glTF is not supported.
  - Units are guessed: models are read as millimetres, and very small ones as centimetres, inches or metres. If the size
    comes out wrong, upload again with **Height mm** (e.g. 32 for a human on a 25 mm base). **Base mm** sets the
    footprint (25–40 mm = 1 square, 50 mm = 2×2). **Up axis**: Z for most STL files, Y for Blender/glTF exports.
  - Meshes above 500,000 triangles are simplified automatically.
  - Uploads appear under **Uploaded** with the uploader's name; the uploader and the GM can rename (✎) or delete (🗑) them.
    Tokens using a deleted figure turn back into plain pawns.
- **Players:** the GM ticks **Players may upload their own figures** at the bottom of the Minis tab. Then select a token you
  control and upload (it is applied to that token), or press **Use** next to one of your uploads.
- **Facing:** rotation 0 faces the bottom edge of the map (toward the players' side of the 3D table); **Q / E** turn the
  selected token 45 degrees. The white tick on 2D tokens points the same way.
- **Private library:** the owner's private miniatures appear in Figures/Scenery when the server is configured with a
  library source (docs/development/deployment.md, Private miniatures).

## Shortcuts
V select · H pan · M measure · D draw · E erase · P ping · T token (GM) · G fog (GM) · +/− zoom · F fit ·
C centre on selection · arrows move selection or pan · Delete removes the selected token (GM) · Esc clears.

## Dice formulas
`1d20`, `2d6+3`, `4d8`, `1d20-2`, `d%`, `2d20kh1` (keep highest), `2d20kl1` (keep lowest), `4d6dl1` (drop lowest).
