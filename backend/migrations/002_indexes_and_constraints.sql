-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002 — performance indexes, hardened constraints, legacy data fixes.
-- Run this in the Supabase SQL editor after migration 001.
-- Safe to re-run (uses IF NOT EXISTS / IF EXISTS guards).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Indexes on hot read paths -------------------------------------------------

-- goals: filtered by (user_id, month) on every Goals/Home/Elsie load
CREATE INDEX IF NOT EXISTS idx_goals_user_month
  ON goals(user_id, month);

-- goals: per-user listing ordered by created_at (LC chat context)
CREATE INDEX IF NOT EXISTS idx_goals_user_created
  ON goals(user_id, created_at);

-- journal_entries: ordered listing on Celebrate/Journal
CREATE INDEX IF NOT EXISTS idx_journal_entries_user_date
  ON journal_entries(user_id, date DESC);

-- reflections: latest-per-user lookup in LC chat context
CREATE INDEX IF NOT EXISTS idx_reflections_user_created
  ON reflections(user_id, created_at DESC);


-- 2. Migrate legacy 'achieved' goal status to canonical 'completed' ----------
-- The frontend + LC schema use 'completed' now. Old rows may still have 'achieved'.
UPDATE goals SET status = 'completed' WHERE status = 'achieved';


-- 3. Harden the goals.status check constraint ---------------------------------
-- Drop any existing check constraint named goals_status_check, then add a new
-- one with the canonical enum.
ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_status_check;
ALTER TABLE goals
  ADD CONSTRAINT goals_status_check
  CHECK (status IN ('active', 'completed', 'shelved'));


-- 4. Drop the dead planner_sessions table if it exists -----------------------
-- Planner was rolled into LC. The route + frontend component have been deleted.
DROP TABLE IF EXISTS planner_sessions;
