-- Characters: common fields are columns; ruleset-defined sheet values live in data (validated against the
-- ruleset's sheet sections in shared/characters.ts). sheet_schema_version records which sheet layout wrote them.
CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  portrait_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  ruleset_id TEXT NOT NULL,
  sheet_schema_version INTEGER NOT NULL DEFAULT 1,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX characters_campaign_idx ON characters(campaign_id);
CREATE INDEX characters_owner_idx ON characters(owner_id);
ALTER TABLE tokens ADD COLUMN character_id TEXT REFERENCES characters(id) ON DELETE SET NULL
