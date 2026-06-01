-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 004 — Programs as a first-class entity.
-- A "program" is the trainer's organizing unit: a cohort, a workshop series,
-- a leadership intensive, an onboarding pilot. Goals, journal entries, and
-- reflections can optionally tag a program for filtering and aggregation.
--
-- Run in the Supabase SQL editor after migrations 001-003.
-- Safe to re-run (uses IF NOT EXISTS / IF EXISTS guards).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Programs table ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS programs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'completed', 'archived')),
  start_date     DATE,
  end_date       DATE,
  learner_count  INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_programs_user_status
  ON programs(user_id, status);

CREATE INDEX IF NOT EXISTS idx_programs_user_updated
  ON programs(user_id, updated_at DESC);

-- Auto-update updated_at on every row update (same pattern as lc_conversations)
CREATE OR REPLACE FUNCTION programs_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_programs_touch_updated_at ON programs;
CREATE TRIGGER trg_programs_touch_updated_at
  BEFORE UPDATE ON programs
  FOR EACH ROW EXECUTE FUNCTION programs_touch_updated_at();


-- 2. Add optional program_id to child tables ---------------------------------
-- ON DELETE SET NULL — deleting a program does NOT cascade-delete its history.
-- Entries simply become untagged. This preserves the trainer's work.

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS program_id UUID NULL REFERENCES programs(id) ON DELETE SET NULL;

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS program_id UUID NULL REFERENCES programs(id) ON DELETE SET NULL;

ALTER TABLE reflections
  ADD COLUMN IF NOT EXISTS program_id UUID NULL REFERENCES programs(id) ON DELETE SET NULL;


-- 3. Indexes on the new columns for filtering performance --------------------
CREATE INDEX IF NOT EXISTS idx_goals_user_program
  ON goals(user_id, program_id);

CREATE INDEX IF NOT EXISTS idx_journal_entries_user_program
  ON journal_entries(user_id, program_id);

CREATE INDEX IF NOT EXISTS idx_reflections_user_program
  ON reflections(user_id, program_id);


-- 4. RLS policies for programs (matches the pattern in migration 003) --------
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS programs_select_own ON programs;
DROP POLICY IF EXISTS programs_insert_own ON programs;
DROP POLICY IF EXISTS programs_update_own ON programs;
DROP POLICY IF EXISTS programs_delete_own ON programs;

CREATE POLICY programs_select_own ON programs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY programs_insert_own ON programs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY programs_update_own ON programs FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY programs_delete_own ON programs FOR DELETE USING (auth.uid() = user_id);
