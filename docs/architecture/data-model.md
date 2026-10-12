# Data model

Schema source of truth: `server/db/migrations/*.sql` (applied in filename order, tracked in
`schema_migrations`). Identifiers are text with a type prefix and 72 random bits (`cmp_…`, `ses_…`,
`tok_…`; `server/ids.ts`) so exported data stays portable between databases.

## Tables (0001_init.sql)
| Table | Purpose | Key columns / constraints |
|---|---|---|
| users | accounts | display_name 1–40 chars |
| auth_sessions | login sessions | token_hash = sha256(cookie token), expires_at (30 days) |
| campaigns | a campaign | ruleset_id (default `generic`), owner_id |
| campaign_members | membership + role | PK (campaign_id, user_id); role ∈ owner, gm, assistant_gm, player, spectator |
| invitations | invite links | token_hash unique, role (not owner/gm), expires_at, max_uses, uses, revoked |
| assets | uploaded files' metadata | mime (sniffed), bytes, width, height, storage_key, license, attribution |
| maps | static map config | background_asset_id, width, height, grid (JSONB, validated by `GridConfig`), fog_enabled, version |
| game_sessions | one table event | status ∈ open, paused, closed; active_map_id; seq (per-session event counter) |
| tokens | placed token instances (hot state) | map_id, x, y, rotation, size, hidden, locked, owner_ids TEXT[], hp, hp_max, conditions TEXT[], attributes JSONB, version |
| fog_regions | ordered reveal/hide shapes | mode ∈ reveal, hide; shape JSONB (`FogShape`) |
| drawings | annotations | author_id, gm_only, shape JSONB (`DrawingShape`), expires_at (temporary) |
| dice_rolls | server-authoritative rolls | expression, result JSONB (per-die terms + label), total, visibility ∈ public, gm, self |
| chat_messages | chat log | kind ∈ text, roll, system; roll_id; visibility |
| encounters | one per session | round, turn_index, active |
| encounter_participants | turn order entries | token_id (nullable), name, initiative, hidden, sort_order |
| session_events | bounded audit log | PK (session_id, seq); type, actor_id, payload (target id only — never chat/note text) |

Indexes exist on every foreign key used for lookups (campaign, map, session).

## Design notes
- **Hot vs static state.** Token positions live in `tokens` rows with an optimistic-concurrency
  `version`; map configuration lives in `maps` with its own `version`. Moving a token never rewrites the map.
- **Ordering.** `game_sessions.seq` is bumped inside the same transaction as every applied command (except
  pings) and is stamped on every event.
- **Retention.** `session_events` keeps roughly the last 1000 events per session; every 100th event prunes older
  rows. Chat and dice history are kept; snapshots send the last 100 visible messages.
- **Deletes.** Campaign deletion cascades to members, maps, sessions and their children; assets keep their row
  (`campaign_id SET NULL`) because storage objects need explicit cleanup. Deleting a token cascades to its
  encounter participants.
- **Not yet modelled** (see roadmap): characters/character data, journals, handouts, asset collections,
  ruleset versions in the database (rulesets are code modules today), per-session member overrides.
