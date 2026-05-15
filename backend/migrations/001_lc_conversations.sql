-- ─────────────────────────────────────────────────────────────────────────────
-- LC (Learning Companion) chat persistence
-- Run this in the Supabase SQL editor to create the conversations table.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lc_conversations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title          TEXT,
  messages       JSONB NOT NULL DEFAULT '[]'::jsonb,
  planner_mode   BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lc_conversations_user_updated
  ON lc_conversations(user_id, updated_at DESC);

-- Auto-update the updated_at column on every row update
CREATE OR REPLACE FUNCTION lc_conversations_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lc_conversations_touch_updated_at ON lc_conversations;
CREATE TRIGGER trg_lc_conversations_touch_updated_at
  BEFORE UPDATE ON lc_conversations
  FOR EACH ROW EXECUTE FUNCTION lc_conversations_touch_updated_at();
