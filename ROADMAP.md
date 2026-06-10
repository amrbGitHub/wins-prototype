# Roadmap

Living list of deliverables for the Celebrating Wins app. Source of truth for
"what's next" — update as items land or priorities shift. Pair with
`TESTING.md` for the architecture snapshot.

---

## In flight / next up

### Quality of L&D support from the LLM
Improve substance of LC's responses for trainers. Candidates:
- Citations / sources surfaced inline
- Web search tool for grounding (e.g. current L&D frameworks, research)
- Fine-tuning or system-prompt iteration against real trainer conversations

### Unify backend on the frontier model
Journal/Celebrate analyzers currently depend on a local Ollama tunneled
through ngrok — fragile, offline-prone. Goal: route all AI calls through the
Anthropic-compatible frontier endpoint so the app works without a developer
laptop being on.

### Token efficiency pass
Audit prompt sizes, summary lengths, and per-turn payloads. Likely targets:
- Per-conversation summary cap
- Per-pseudonym summary cap (currently 400 chars)
- Redundant context being resent each turn
- Tool-call schema verbosity in the system prompt

### Pluggable LLM provider (multi-tenant readiness)
Let a business bring its own frontier model. Anthropic-compatible is already
the abstraction; formalize provider config per-org (base URL, key, model id,
summary model id) and surface it in admin settings. Keep the redaction layer
provider-agnostic.

### Admin page — v2 powers
v1 shipped on `lc-modular`: role-based gating, LLM provider config, user
inspection (entries/goals/programs/reflections/LC chats), user deletion.
Next candidates, grouped by problem they solve:

- **Account management**: promote/demote admins from the UI (kills the env-var
  dance), suspend-vs-delete via `is_disabled`, trigger password-reset email on
  a user's behalf, edit a user's profile for support cases.
- **Observability**: LLM usage per user (tokens + rough cost, split chat vs
  summary updater), failed-action log (every `resolveActions` drop + claude
  error), last-active timestamp per user.
- **Quality / safety**: side-by-side LC chat view showing the pseudonymized
  payload actually sent to the model next to the rehydrated version — proves
  the redaction story works on real conversations. System-prompt editor in
  the admin UI for prompt iteration without a deploy (risky, high leverage).
- **Data**: per-user JSON export (GDPR-shaped), targeted `clear-pseudonyms`
  for a user whose registry got polluted.

Top three picks if forced to prioritize: promote/demote admins, LLM usage per
user, pseudonymized side-by-side chat view.

### External account connections
OAuth-link a user's LinkedIn / Email (Gmail?) / Slack so the celebration
message draft from the Celebrate tab can be posted directly. Per platform:
auth flow, scopes, post endpoint, error/retry UX.

### User-facing FAQ / docs site
A real docs surface for testers and prospective businesses. Top-of-mind
content:

- Supported LLM providers and the hard requirement: native tool calling.
  Concrete examples of what works (Claude Haiku 4.5, GPT-4o-mini, Gemini
  2.0 Flash) and what doesn't (GPT-3.5, small local models, anything
  pre-function-calling).
- Privacy model: what crosses the wire vs what stays local, the
  pseudonymization pipeline, where the encryption keys live, what happens
  when an admin runs `clean-slate`.
- Admin operations: env-var allowlist, LLM provider config, user
  inspection + deletion.
- L&D framing: who LC is for, what the Journal / Celebrate / LC chat
  surfaces each do, and the "win attribution" principle.

Format TBD — could be a `/docs` route in the app, a separate Astro/VitePress
site, or just a sharp README expansion. Decide based on whether testers vs
prospective customers are the primary audience.


---

## Done (recent)

- Admin v1 on `lc-modular`: role-gated admin page, LLM provider config
  (env-fallback + DB-overridable + encrypted API key), user inspection
  (entries/goals/programs/reflections/LC chats), user delete with
  type-email-to-confirm, env-var admin allowlist with lazy DB reconcile.
- Username removed from UI + backend write/read path (DB column intact).
- LC tool-protocol fix: reconstruct `tool_use`/`tool_result` pairs in history
  so the model has concrete proof prior calls executed. Kills the
  duplicate-emission-on-next-turn bug across all five auto-executing tools.
- `frontend-ner` merged to main (PII pipeline, LC chat hardening)
- `/api/account/clean-slate` promoted to user-facing with password re-verify
- LC chat: streaming removed, cycling thinking verbs added
- `TESTING.md` rewritten as architecture reference
- Graphify removed (was bloatware for a 78-file codebase)
- Render deploy of `bd412d3`
