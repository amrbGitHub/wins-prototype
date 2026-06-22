-- 011_drop_llm_usage.sql
-- Removes the per-call token accounting table introduced in 010_admin_v2.sql.
--
-- Reason: tracking individual users' LLM consumption is the wrong fit for an
-- enterprise app where AI is the product. The only legitimate use we found
-- was abuse detection, and a provider-agnostic request log (planned) is a
-- cleaner, more reliable signal for that than tokens.
--
-- The `lc_message_audit` table from migration 010 stays — it's the
-- pseudonymization audit trail, not usage accounting, and it's still needed
-- for the privacy boundary side-by-side admin view.

DROP TABLE IF EXISTS public.llm_usage;
