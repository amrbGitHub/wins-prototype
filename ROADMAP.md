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

### Admin page
Internal-only view for an admin to inspect users' entries, goals, programs,
and LC conversation metadata. Respect the encryption boundary — admins should
see plaintext only if that's an intentional product decision; otherwise show
pseudonymized data. Decide the policy before building.

### External account connections
OAuth-link a user's LinkedIn / Email (Gmail?) / Slack so the celebration
message draft from the Celebrate tab can be posted directly. Per platform:
auth flow, scopes, post endpoint, error/retry UX.

### Remove username tag on accounts
Strip the user-visible username field/handle. Confirm scope (display only? DB
column? auth.users metadata?) before touching.

---

## Done (recent)

- LC tool-protocol fix: reconstruct `tool_use`/`tool_result` pairs in history
  so the model has concrete proof prior calls executed. Kills the
  duplicate-emission-on-next-turn bug across all five auto-executing tools.
- `frontend-ner` merged to main (PII pipeline, LC chat hardening)
- `/api/account/clean-slate` promoted to user-facing with password re-verify
- LC chat: streaming removed, cycling thinking verbs added
- `TESTING.md` rewritten as architecture reference
- Graphify removed (was bloatware for a 78-file codebase)
- Render deploy of `bd412d3`
