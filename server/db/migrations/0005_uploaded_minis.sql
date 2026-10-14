-- Bring-your-own figures (ADR 0011): uploads converted to the parts mesh format, stored through Storage, per campaign.
CREATE TABLE uploaded_minis (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  item JSONB NOT NULL,
  storage_key TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX uploaded_minis_campaign_idx ON uploaded_minis(campaign_id);
-- campaign setting: players may upload figures for their own tokens (GMs always can)
ALTER TABLE campaigns ADD COLUMN player_mini_uploads BOOLEAN NOT NULL DEFAULT false
