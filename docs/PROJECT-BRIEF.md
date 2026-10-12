# PROJECT: OPEN TABLETOP — System-Agnostic Multiplayer Virtual Tabletop

> Source: the project owner's brief (2026-10-12), restated section by section so agents can resume work. Section numbers match the original.

**Role:** autonomous senior engineer / architect / multiplayer engineer / UX designer. Implementation assignment, not a proposal. Inspect, plan concretely, build, test. Don't rewrite working code; preserve conventions; decide for extensibility. When info is missing, decide, document assumptions, continue; ask only when truly blocked or destructive. Supports D&D, Pathfinder, other TTRPGs, indie systems, homebrew.

## 1. Product vision
Users can: create accounts, join groups; create campaigns and sessions; invite via links/invitations; large interactive battle maps; upload maps/assets; place miniatures, monsters, NPCs, objects, terrain, effects; move miniatures; measure distance and movement ranges; square/hex/gridless maps; fog of war and dynamic visibility; roll and share dice; track sheets, health, initiative, conditions, resources; manage combat; share handouts, notes, images; text chat (voice/video later); play with or without rules automation; build custom rulesets.
Feels like: physical miniature table + collaborative drawing/mapping app + campaign/character manager + lightweight multiplayer engine + extensible RPG platform. The table dominates, not admin dashboards. Usable by first-time VTT users.
Principles: system-agnostic core; multiplayer by default; GM authority/permissions; fast intuitive interactions; flexible homebrew; modular; data portability; extensible assets and rules; desktop-first, responsive to tablets/small screens; no proprietary/paid dependence; no required asset purchases; separation of infrastructure, rules, user content.

## 2. Initial repository investigation
Determine frontend, backend/API, DB/schema, auth, UI library, graphics libs, realtime, deployment, tests/build, env/integrations, reusable features. Write docs/architecture/repository-assessment.md, docs/implementation/roadmap.md, ADRs in docs/architecture/decisions/. Don't replace tech without compelling reason. Empty repo → clean foundation. Run baseline tests/build; record pre-existing failures. Never expose secrets anywhere.

## 3. Recommended architecture (adapt)
Frontend: Next.js+React, TypeScript, Tailwind, shadcn/ui or existing, dedicated tabletop rendering layer, Zustand or equivalent. Graphics: PixiJS or similar; SVG icons; canvas interaction layers; optional WebGL. Backend: Next.js server or dedicated backend; PostgreSQL; WebSocket realtime; object storage. Auth: reuse or maintainable choice; users, memberships, invitations, session permissions. Deployment: compatible with hosting; Vercel serverless can't hold permanent WebSockets → managed realtime or separate collaboration server; DB, storage, realtime independently configurable. Testing: unit, integration, E2E, multiplayer. No unnecessary microservices; modular monolith.
Modules: auth/identity; groups/friendships; campaigns; sessions; tabletop; maps/terrain; tokens; assets; characters; rulesets; dice; encounters/initiative; fog/vision; chat; notes/handouts; import/export; admin/permissions. Rendering engine never coupled to D&D/Pathfinder.

## 4. Application structure
Routes: / landing; /dashboard; /campaigns; /campaigns/[campaignId]; /sessions/[sessionId] (the table); /maps; /assets; /characters; /rulesets; /settings. Table is a full workspace.
Layout — Top bar: session & campaign name, connection status, players, save status, GM controls, settings, leave. Left toolbar: select, pan, move, measure, draw, erase, place token, place object, paint terrain, templates, fog, ping. Center: canvas, grid, minis, terrain, lighting/visibility, measurement, drawing layers. Right sidebar: players/characters, initiative, encounter, token inspector, chat, journal/handouts. Bottom: quick tools, dice, frequent actions, hotbar. Collapsible sidebars; contextual controls; gaming-table look, not admin dashboard.

## 5. Virtual tabletop engine (central feature)
5.1 Camera: drag pan, wheel zoom around cursor, fit, reset, center on selection/ping, minimap if useful, keyboard nav, touch. World coords independent of zoom/resolution; maps larger than viewport; cull off-screen.
5.2 Layers: background, terrain, static objects, grid, annotations, GM notes, token art, labels, measurement, vision/lighting, fog, selection, temporary effects. Visibility/locking; tokens movable without moving background. Persistent vs transient state (drag preview local, commit on drop).
5.3 Grids: square (cell size), hex pointy/flat, gridless. Settings: cell size, offset, alignment, visibility, color/opacity, optional snapping, scale, units per cell, distance convention. Not always 5 ft (m, ft, yd, bands, none). Grid math separate from ruleset movement.
5.4 Backgrounds: upload, raster formats, safe vectors, position/scale, crop/rotate, opacity, grid alignment, multiple assets, metadata, duplication. Workflow: upload → dimensions → grid type → calibrate → scale → save → open in session. No JSON editing.
5.5 Drawing: freehand, lines, rects, circles, polygons, text, arrows, pings, temp markers, erase, undo/redo, width/color, GM-private annotations, expiring temporary annotations, persistent drawings stored.

## 6. Miniatures, tokens, objects
2D first. Categories are labels: PCs, NPCs, monsters, allies, enemies, summons, vehicles, environmental/interactive objects, markers, custom. Artwork: PNG/WebP/sanitized SVG, library reuse, crop, circle/square masks, resize/rotate, borders/colors, labels, health indicators, status icons, show/hide labels, duplicate, lock, delete, move layers. Definitions (reusable) vs instances (placed). Instance metadata: id, session, optional character, name, category, position, rotation, scale, asset ref, visibility, ownership, movement restrictions, health ref, initiative ref, conditions, custom attributes, optional system data — extensible, no forced HP/AC. Selection: single, multi, box, shift-click, drag, rotate, resize, copy/paste, duplicate, delete, undo/redo, context menus, shortcuts; careful pointer handling; immediate feel with server confirmation.

## 7. Multiplayer
7.1 GM: campaign → session → map → characters/tokens → invite → start → continue later. Private by default; invite links with permissions and expiry. 7.2 Sync token move/rotate/create/delete, drawings, map/grid config, initiative, dice, chat, presence, public actions, fog, character updates. Events like session.token.created|moved|updated|deleted, session.map.updated, session.drawing.*, session.initiative.updated, session.dice.rolled, session.chat.message_created, session.visibility.updated, session.member.joined|left — explicit schemas, validation, authorization. 7.3 Concurrent players and moves, reconnection, initial + incremental sync, ordering, dedup, stale detection, authoritative permission checks, recovery after restart. Server-authoritative; optimistic local moves confirmed by server; deterministic conflict rules (locks or versions); sequence numbers. No CRDT for novelty. 7.4 States: connected, connecting, reconnecting, offline, synchronizing, changes pending; never silently drop changes.

## 8. Permissions
Roles: owner, GM, assistant GM, player, spectator — server-enforced. GM: maps, any token, NPCs, encounters, initiative, fog, reveal/conceal, GM notes, ownership, player permissions, pause/close, export. Player: revealed map, own characters, permitted info, dice, chat, measure, personal notes, shared handouts, permitted objects; GM can override. Spectator: configurable read-only. Prevent hidden-data leaks, editing others' characters, unauthorized notes/admin, cross-campaign access, forged server dice, unauthorized uploads/retrieval. Hidden tokens' metadata never sent to unauthorized clients — filter server-side.

## 9. Fog, vision, lighting
Reveal all, conceal all, manual reveal/hide, polygon and brush reveal, persistent explored, temporary, GM-only, per-player where practical. Foundation for vision radius, cones, LOS, walls, darkvision-like, lights, modes — incremental; reliable manual fog first. Later walls, doors, windows, barriers, light radius/intensity/color, ambient, darkness. Vision, lighting, movement, rules independently configurable.

## 10. Measurement and movement
Point-to-point, multi-segment, paths, area, circle/cone/line templates, units, optional snapping, diagonal conventions, configurable pathfinding, labels, temporary overlays. Per-map scale. Rulesets provide movement cost policies; engine provides geometry; gridless uses calibrated world coordinates.

## 11. Dice
d4–d100, arbitrary sides, multiple dice, modifiers, optional adv/disadv, history, shared, private GM/player, public, formulas (1d20, 2d6+3, 4d8, 1d20-2, 1d100, 2d20kh1). Validated parser, never eval; limits on counts, sides, nesting, cost. CSPRNG; server-authoritative shared rolls. Store expression, per-die results, modifier, total, timestamp, user, visibility. Animations can't alter results. Compact UI on table.

## 12. Characters
Universal model; fields name, portrait, description, owner, campaign, level, attributes, skills, inventory, abilities, resources, health, conditions, notes, relationships, custom, ruleset data — validated, schema-versioned structured data; common fields relational; not one blob. Configurable sections from rulesets (fantasy, sci-fi, narrative). Multiple characters per player; GM assigns/transfers; permission-bound.

## 13. Encounters and initiative
Add PCs/NPCs/opponents, reorder, manual/rolled initiative, rounds, turns, active highlight, conditions, health, notes, hidden and grouped combatants, reset, save/restore. Optional/replaceable trackers; generic turn-order interface; active combatant shown on map and panel; optional notifications; no automatic resource changes unless ruleset says.

## 14. Assets and import
Categories maps, minis, portraits, monsters, NPCs, terrain, furniture, trees, buildings, vehicles, items, tokens, effects, handouts, audio, custom. Upload, tag, search, filter, preview, reuse, collections, import/export, ownership/sharing. Object storage not DB; thumbnails; validate uploads (malicious files, unsafe SVG, traversal, size); no code execution. Licensing: no scraping/bundling copyrighted content; metadata for source, creator, license, attribution.

## 15. Game-system agnostic architecture (critical)
Interfaces (TS + runtime validation + versioned): GameSystemDefinition (id, name, version, description, capabilities, character schema, token defaults, rules modules, encounter module, measurement policy, dice extensions); CharacterSheetProvider; RollProvider; MovementPolicy; DistancePolicy; EncounterProvider; ConditionProvider; ActionProvider; RulesetManifest (identity, version, capabilities, permissions, schemas, extension points). Accommodate D&D 5e, D&D 2024, PF2e, OSR, generic fantasy, sci-fi, horror, narrative, homebrew. Deliver generic core, stable interfaces, one demo ruleset, one homebrew example, proof a second ruleset needs no engine changes. Accurate trademarks; no proprietary text; SRD imports respect licenses.

## 16. Chat, journals, handouts
Chat: public, GM-only, private, dice, system, timestamps, identity, basic formatting, history. Journals: campaign/session notes, locations, NPCs, quests, lore, private GM, shared player. Handouts: images, text, maps, documents, clues, letters, portraits; reveal to selected players or party; server-enforced.

## 17. Campaigns and sessions
Separate. Campaign: members, characters, maps, assets, notes, journals, encounters, history, config. Session: one table event. Create, start, pause, resume, close, history, last-session recovery, invitations, ownership transfer, duplication, export. Next session resumes saved state.

## 18. Data model
Normalized; evaluate users, profiles, campaigns, campaign_members, invitations, sessions, session_members, maps, map_layers, map_assets, assets, asset_collections, tokens, characters, character_data, rulesets, ruleset_versions, encounters, encounter_participants, dice_rolls, chat_messages, journal_entries, handouts, drawings, fog_of_war_regions, session_events, permissions. Stable ids, timestamps, versions, migrations, indexes, constraints, careful deletes, transactions, minimal duplication, static map config separate from hot token state, event retention strategy.

## 19. Import/export
Versioned JSON export (metadata, characters, maps, tokens, encounters, journals, handouts, asset metadata, ruleset ids/versions, settings); validated import, graceful missing assets, clear incompatibility errors, no scripts; archive for binaries with limits and safe extraction; documented schema and versioning.

## 20. Performance
Targets: 1 GM, 4–8 players, hundreds of objects, dozens of tokens, large maps, frequent moves/chat. Profile. No React re-render per pointer move; separate canvas state; culling/spatial index; throttle transient moves, keep final; caching; pagination/virtualization. No premature distribution.

## 21. Security
Server-side authz, session isolation, membership checks, input/upload validation, rate limits, safe rich text, secure auth, secure invite tokens, safe queries, secrets management, safe errors, audit admin actions. Schema validation at boundaries; realtime gets same authz as HTTP; never trust client roles; safe reconnection; don't log private content.

## 22. Accessibility/UX
Keyboard, focus, contrast, type, tooltips, SR labels, reduced motion, text size, clear errors, undo, confirm destructive, responsive sidebars, empty/loading/error states. Inspector alternatives for canvas ops (position, rotation, visibility, ownership).

## 23. Visual design
Dark low-glare table, clear hierarchy, restrained borders/shadows, high-contrast controls, distinct player/selection/visibility colors, clean icons, restrained motion, consistent spacing, readable type; optional light theme; map gets most space; full-screen; design tokens. No decorative placeholder buttons — working or marked planned.

## 24. Testing
Unit: grid conversion, square/hex snapping, gridless measurement, distance, transforms, dice parse/eval, permissions, ruleset validation, serialization, export validation, event validation, visibility filtering. Integration: campaign/session creation, invitations, token/map persistence, characters, dice persistence, authorization, upload validation, export/import. E2E: create campaign; create session; GM uploads map; configures grid; adds tokens; second user joins; sees map; player moves token; GM sees it; both see roll; GM hides region; player can't access hidden info; close; reopen; state restored. Separate browser contexts; reconnection and concurrent edits; reliable CI.

## 25. Phases (each leaves repo working)
0 Audit. 1 Foundation: shell, nav, (dev) auth, campaigns, sessions, schema, migrations, membership/permissions, seed, tests. 2 Tabletop: full-screen, engine, pan/zoom, map upload, grids, calibration, token place/move/rotate, selection, inspector, persistence. 3 Multiplayer: realtime, presence, authoritative updates, reconnection, permissions, validation, conflicts, tests. 4 Gameplay: dice, history, measurement, paths, templates, drawing, initiative, encounters, chat, optional health/status. 5 GM tools: fog, GM notes, hidden tokens, visibility, handouts, journals, encounter prep, layers, recovery. 6 Rules: interfaces, generic characters, configurable sheets, dice, policies, manifests, versioning, homebrew + second ruleset. 7 Assets & import/export. 8 Polish/production: performance, a11y, responsive, error recovery, logging, security review, CI, deploy config, user docs, E2E.

## 26. MVP acceptance
Dev-auth entry → campaign + session → upload map → grid mode → scale → tokens → assign to players → invite → both open session → same state → permitted player moves → others see without refresh → independent pan/zoom → measure → shared dice → GM initiative → GM conceals/reveals → players can't access private info → close/reopen intact → tests pass → production build succeeds → no hardcoded demo-data dependence → no decorative controls.

## 27. Documentation
README; docs/architecture/{repository-assessment, system-overview, data-model, realtime-protocol, ruleset-system, security}.md; docs/implementation/roadmap.md; docs/development/{local-setup, testing, deployment}.md; docs/user/getting-started.md. Cover run, env vars, DB, migrations, realtime, uploads, tests, adding rulesets, extending sheets/dice/movement, deploy. Placeholder secrets only.

## 28. Autonomous rules
Loop: highest-priority gap → tasks → implement → test → fix → review → document → next. Vertical slices, small changes, justified deps, no destructive ops, no production deploy/paid services/public publishing without authorization. Missing credentials → integration boundary + docs. Keep a repo checklist for resumption. Each cycle report: implemented, files, migrations, tests run, build, limitations, remaining, next step. Never claim unrun tests or UI-only features as done.

## 29. Final objective
A shared map with miniatures at the core, independent of any one RPG system, extensible without rewrite. Audit, Phases 0 and 1, then tabletop engine. Working multiplayer table over elaborate nonfunctional prototype.
