-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 006 — Per-conversation pseudonym tracking + orphan GC.
--
-- Pseudonyms in `pseudonym_registry` are durable across conversations by
-- design (so Claude has continuity when the user mentions "James" again next
-- week). But that means deleting a conversation does NOT delete the people
-- it mentioned, even if no other conversation references them anymore.
--
-- This migration adds:
--   1. A junction table `lc_conversation_pseudonyms` recording which
--      pseudonyms each conversation references. Inserted into on every
--      gateway turn for each pseudonym used.
--   2. A SQL function `delete_orphan_pseudonyms(user_id)` that drops
--      registry rows for that user with no remaining junction references.
--      Called by the backend after a conversation is deleted.
--
-- Run in the Supabase SQL editor after migrations 001-005.
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lc_conversation_pseudonyms (
  conversation_id        UUID NOT NULL REFERENCES lc_conversations(id)  ON DELETE CASCADE,
  pseudonym_registry_id  UUID NOT NULL REFERENCES pseudonym_registry(id) ON DELETE CASCADE,
  first_referenced_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, pseudonym_registry_id)
);

-- Look-up index for the GC sweep: "any junction rows for this registry id?"
CREATE INDEX IF NOT EXISTS idx_lc_conv_pseudo_by_registry
  ON lc_conversation_pseudonyms(pseudonym_registry_id);


-- RLS — match the rest of the schema. Both FKs already enforce user isolation
-- transitively (you can only insert junction rows for your own conversation
-- AND your own pseudonym), but RLS gives defense in depth.
ALTER TABLE lc_conversation_pseudonyms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lc_conv_pseudo_select_own ON lc_conversation_pseudonyms;
DROP POLICY IF EXISTS lc_conv_pseudo_insert_own ON lc_conversation_pseudonyms;
DROP POLICY IF EXISTS lc_conv_pseudo_delete_own ON lc_conversation_pseudonyms;

-- Join through conversation_id to auth.uid() — the row is yours if the
-- conversation is yours.
CREATE POLICY lc_conv_pseudo_select_own ON lc_conversation_pseudonyms FOR SELECT
  USING (EXISTS (SELECT 1 FROM lc_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));
CREATE POLICY lc_conv_pseudo_insert_own ON lc_conversation_pseudonyms FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM lc_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));
CREATE POLICY lc_conv_pseudo_delete_own ON lc_conversation_pseudonyms FOR DELETE
  USING (EXISTS (SELECT 1 FROM lc_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));


-- ── Orphan GC function ──
-- Drops every pseudonym_registry row belonging to p_user_id that has no
-- remaining junction references. Returns the number of rows deleted.
-- SECURITY DEFINER so it can be called via supabase.rpc() with the service
-- role and still scope to the requesting user.
CREATE OR REPLACE FUNCTION delete_orphan_pseudonyms(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM pseudonym_registry pr
  WHERE pr.user_id = p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM lc_conversation_pseudonyms lcp
      WHERE lcp.pseudonym_registry_id = pr.id
    );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
