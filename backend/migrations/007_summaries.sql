-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 007 — Encrypted summary storage for the stateless-Claude model.
--
-- Architectural shift: instead of sending the full chat history to Claude on
-- every turn, we send only:
--   1. Long-term per-pseudonym summaries ("what we know about Person_4F2C")
--   2. A short rolling per-conversation summary ("where we are in this chat")
-- plus the new user message.
--
-- Claude never sees verbatim history. Anthropic's servers only ever see one
-- turn at a time plus opaque summaries. Token cost stops scaling with
-- conversation length.
--
-- Both summary types are AES-GCM encrypted with the per-user key (same scheme
-- as pseudonym_registry.encrypted_real_value). The summary content is already
-- pseudonymized — it talks about Person_4F2C, not James — but we encrypt
-- anyway as defense in depth.
--
-- Lifecycle:
--   - pseudonym_summaries: persist as long as the pseudonym exists. Cascade
--     when pseudonym_registry row is deleted (by orphan-GC or global wipe).
--   - conversation_summaries: cascade when lc_conversations row is deleted.
--
-- Run in the Supabase SQL editor after migrations 001-006.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- Per-person evolving notes. One row per pseudonym (PK = registry_id).
CREATE TABLE IF NOT EXISTS pseudonym_summaries (
  pseudonym_registry_id  UUID PRIMARY KEY REFERENCES pseudonym_registry(id) ON DELETE CASCADE,
  encrypted_summary      BYTEA NOT NULL,
  version                INTEGER NOT NULL DEFAULT 1,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Per-conversation rolling summary. One row per conversation (PK = convo id).
CREATE TABLE IF NOT EXISTS conversation_summaries (
  conversation_id    UUID PRIMARY KEY REFERENCES lc_conversations(id) ON DELETE CASCADE,
  encrypted_summary  BYTEA NOT NULL,
  version            INTEGER NOT NULL DEFAULT 1,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- RLS — both tables expose ownership transitively through their FK target.
-- A row in pseudonym_summaries belongs to you if the pseudonym does;
-- a row in conversation_summaries belongs to you if the conversation does.

ALTER TABLE pseudonym_summaries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_summaries  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pseudonym_summaries_all_own    ON pseudonym_summaries;
DROP POLICY IF EXISTS conversation_summaries_all_own ON conversation_summaries;

CREATE POLICY pseudonym_summaries_all_own ON pseudonym_summaries
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM pseudonym_registry pr WHERE pr.id = pseudonym_registry_id AND pr.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM pseudonym_registry pr WHERE pr.id = pseudonym_registry_id AND pr.user_id = auth.uid()));

CREATE POLICY conversation_summaries_all_own ON conversation_summaries
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM lc_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM lc_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));
