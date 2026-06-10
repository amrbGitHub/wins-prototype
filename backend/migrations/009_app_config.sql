-- 009_app_config.sql
-- Singleton key/value table for app-wide configuration writable only by
-- admins via the backend service-role client. RLS is enabled and denies all
-- direct client access — the service role bypasses it.
--
-- Used initially for LLM provider config (base URL, models, encrypted API
-- key, sampling params). Schema keeps things flexible: value is jsonb so we
-- can add new keys without further migrations.

CREATE TABLE IF NOT EXISTS public.app_config (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
-- No policies → no direct client reads or writes; service role bypasses RLS.
