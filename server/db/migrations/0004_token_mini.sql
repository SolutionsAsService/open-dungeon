-- 3D miniatures (ADR 0010): a token can show a model from the miniature library (shared/minis.ts MiniId).
-- Position, facing (rotation), size and owners stay the existing token columns, so 2D and 3D share one token.
ALTER TABLE tokens ADD COLUMN mini_id TEXT CHECK (mini_id ~ '^[a-z0-9][a-z0-9-]{0,63}$')
