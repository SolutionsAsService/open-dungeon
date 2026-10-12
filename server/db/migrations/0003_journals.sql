-- Journals and handouts: one table. kind is a label (note, location, npc, quest, lore, handout);
-- visibility decides who may read it and is enforced in server/journal.ts (shared/journal.ts canReadEntry).
--   private  = only the author (personal notes; private GM notes)
--   gm       = owner, GM and assistant GMs
--   players  = GMs + the members listed in shared_with (handouts revealed to selected players)
--   all      = every campaign member, spectators included (party handouts, shared lore)
CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'location', 'npc', 'quest', 'lore', 'handout')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
  image_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'gm' CHECK (visibility IN ('private', 'gm', 'players', 'all')),
  shared_with TEXT[] NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX journal_campaign_idx ON journal_entries(campaign_id, updated_at DESC)
