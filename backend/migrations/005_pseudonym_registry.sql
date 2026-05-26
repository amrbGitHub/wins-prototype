-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 005 — Pseudonym registry for the Claude PII gateway.
--
-- When the user mentions a real person/org/location in chat, we replace it
-- with a stable pseudonym (e.g. "Person_4F2C") before sending the message to
-- Claude. The mapping must persist per-user across sessions so the same real
-- entity always maps to the same pseudonym — that lets us maintain continuity
-- ("the James you mentioned last week") without ever shipping the real name
-- to a third-party API.
--
-- Privacy model:
--   - real_value_hash is HMAC-SHA256(value, master_secret + user_id). Lets us
--     do O(1) lookup by hash without ever storing the plaintext for lookup
--     purposes. Salted per-user so the same name hashes differently across
--     users (admins / DB compromise can't cross-reference).
--   - encrypted_real_value is the actual real value, AES-GCM encrypted with
--     a key derived from master_secret + user_id. The server decrypts this
--     during rehydration; the DB never holds it in cleartext.
--   - pseudonym is the opaque token that goes to Claude.
--
-- Operational notes:
--   - Losing the master encryption key (PSEUDONYM_ENCRYPTION_KEY in .env)
--     bricks every user's registry permanently. Back up the .env securely.
--   - The hash is also keyed by the master secret, so rotating it requires
--     re-hashing every row. Don't rotate without a migration plan.
--
-- Run in the Supabase SQL editor after migrations 001-004.
-- Safe to re-run (uses IF NOT EXISTS / IF EXISTS guards).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pseudonym_registry (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  real_value_hash       TEXT NOT NULL,
  encrypted_real_value  BYTEA NOT NULL,
  pseudonym             TEXT NOT NULL,
  entity_type           TEXT NOT NULL
                        CHECK (entity_type IN ('PERSON', 'ORG', 'LOCATION', 'MISC')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- O(1) lookup by (user, hash) when the redactor asks "have we seen this value before?"
CREATE UNIQUE INDEX IF NOT EXISTS idx_pseudonym_registry_user_hash
  ON pseudonym_registry(user_id, real_value_hash);

-- O(1) reverse lookup by pseudonym during rehydration.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pseudonym_registry_user_pseudonym
  ON pseudonym_registry(user_id, pseudonym);


-- RLS — same pattern as the rest of the schema.
ALTER TABLE pseudonym_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pseudonym_registry_select_own ON pseudonym_registry;
DROP POLICY IF EXISTS pseudonym_registry_insert_own ON pseudonym_registry;
DROP POLICY IF EXISTS pseudonym_registry_update_own ON pseudonym_registry;
DROP POLICY IF EXISTS pseudonym_registry_delete_own ON pseudonym_registry;

CREATE POLICY pseudonym_registry_select_own ON pseudonym_registry FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY pseudonym_registry_insert_own ON pseudonym_registry FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY pseudonym_registry_update_own ON pseudonym_registry FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY pseudonym_registry_delete_own ON pseudonym_registry FOR DELETE USING (auth.uid() = user_id);
