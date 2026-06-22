-- 012_request_log.sql
-- Per-user write-request log. Backs the admin "writes per hour" abuse panel
-- and is the foundation for any future request-shape forensic queries.
--
-- Scope choices:
--   - Authenticated writes only. The middleware skips GETs and unauth requests
--     (req.userId is required). Read paths and unauth flooding are already
--     covered by the IP-based rate limiter.
--   - We don't store bodies. Bodies can contain PII; rows here are pure
--     metadata (who/when/where/how) that an admin can query without a
--     privacy-review conversation.
--   - No tokens, no model. That was llm_usage's job and we removed it
--     deliberately (see 011); request_log is provider-agnostic.

CREATE TABLE IF NOT EXISTS public.request_log (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  method      text NOT NULL,           -- POST / PATCH / PUT / DELETE
  route       text NOT NULL,           -- req.originalUrl, capped to 200 chars in middleware
  status      integer NOT NULL,        -- HTTP status the server returned
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The admin panel queries "rows for user X in the last N hours", so user_id +
-- created_at descending is the hot path. The second index supports
-- writes-per-route slicing if we ever surface it.
CREATE INDEX IF NOT EXISTS request_log_user_created_idx
  ON public.request_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS request_log_user_route_idx
  ON public.request_log (user_id, route);
