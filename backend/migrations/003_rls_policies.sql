-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 003 — Row-Level Security (defense in depth).
-- Run in the Supabase SQL editor after migrations 001 and 002.
--
-- Why: the backend uses the service-role key, which bypasses RLS entirely. So
-- these policies don't change behaviour for the existing app — but they prevent
-- a future code path that forgets `eq('user_id', req.userId)` from leaking
-- data, AND they let the frontend talk to Supabase directly with the anon key
-- if we ever add real-time subscriptions or skip the Express layer.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── goals ────────────────────────────────────────────────────────────────────
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS goals_select_own  ON goals;
DROP POLICY IF EXISTS goals_insert_own  ON goals;
DROP POLICY IF EXISTS goals_update_own  ON goals;
DROP POLICY IF EXISTS goals_delete_own  ON goals;

CREATE POLICY goals_select_own ON goals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY goals_insert_own ON goals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY goals_update_own ON goals FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY goals_delete_own ON goals FOR DELETE USING (auth.uid() = user_id);

-- ── journal_entries ─────────────────────────────────────────────────────────
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS journal_entries_select_own ON journal_entries;
DROP POLICY IF EXISTS journal_entries_insert_own ON journal_entries;
DROP POLICY IF EXISTS journal_entries_update_own ON journal_entries;
DROP POLICY IF EXISTS journal_entries_delete_own ON journal_entries;

CREATE POLICY journal_entries_select_own ON journal_entries FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY journal_entries_insert_own ON journal_entries FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY journal_entries_update_own ON journal_entries FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY journal_entries_delete_own ON journal_entries FOR DELETE USING (auth.uid() = user_id);

-- ── reflections ─────────────────────────────────────────────────────────────
ALTER TABLE reflections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reflections_select_own ON reflections;
DROP POLICY IF EXISTS reflections_insert_own ON reflections;
DROP POLICY IF EXISTS reflections_update_own ON reflections;
DROP POLICY IF EXISTS reflections_delete_own ON reflections;

CREATE POLICY reflections_select_own ON reflections FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY reflections_insert_own ON reflections FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY reflections_update_own ON reflections FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY reflections_delete_own ON reflections FOR DELETE USING (auth.uid() = user_id);

-- ── profiles ────────────────────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select_own ON profiles;
DROP POLICY IF EXISTS profiles_insert_own ON profiles;
DROP POLICY IF EXISTS profiles_update_own ON profiles;

CREATE POLICY profiles_select_own ON profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY profiles_insert_own ON profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY profiles_update_own ON profiles FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── lc_conversations ────────────────────────────────────────────────────────
ALTER TABLE lc_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lc_conversations_select_own ON lc_conversations;
DROP POLICY IF EXISTS lc_conversations_insert_own ON lc_conversations;
DROP POLICY IF EXISTS lc_conversations_update_own ON lc_conversations;
DROP POLICY IF EXISTS lc_conversations_delete_own ON lc_conversations;

CREATE POLICY lc_conversations_select_own ON lc_conversations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY lc_conversations_insert_own ON lc_conversations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY lc_conversations_update_own ON lc_conversations FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY lc_conversations_delete_own ON lc_conversations FOR DELETE USING (auth.uid() = user_id);
