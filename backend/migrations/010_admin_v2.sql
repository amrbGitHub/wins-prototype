-- 010_admin_v2.sql
-- Admin v2 schema additions:
--   1. llm_usage         — per-call token accounting, lets admins see usage
--                          per user split by purpose (chat vs summary vs analyzer).
--   2. lc_message_audit  — per-turn pseudonymized vs real text capture so
--                          admins can side-by-side verify that what's sent to
--                          the LLM provider contains no PII. Append-only.
--
-- Both tables are user-scoped and admin-readable via the service-role client.
-- No user-facing RLS policies needed — only routes under /api/admin read them.

-- ── 1. LLM usage ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.llm_usage (
  id              bigserial PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.lc_conversations(id) ON DELETE SET NULL,
  purpose         text NOT NULL CHECK (purpose IN ('chat', 'summary', 'analyzer')),
  provider        text NOT NULL,
  model           text NOT NULL,
  input_tokens    integer NOT NULL DEFAULT 0,
  output_tokens   integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS llm_usage_user_created_idx
  ON public.llm_usage (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS llm_usage_user_purpose_idx
  ON public.llm_usage (user_id, purpose);

-- ── 2. LC message audit (pseudonymization proof) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.lc_message_audit (
  id                     bigserial PRIMARY KEY,
  user_id                uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id        uuid REFERENCES public.lc_conversations(id) ON DELETE CASCADE,
  turn_index             integer NOT NULL,
  real_user_text         text,
  pseudo_user_text       text,
  real_assistant_text    text,
  pseudo_assistant_text  text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lc_message_audit_user_created_idx
  ON public.lc_message_audit (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lc_message_audit_conversation_idx
  ON public.lc_message_audit (conversation_id, turn_index);
