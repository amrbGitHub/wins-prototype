# Roadmap

Living list of deliverables for the Celebrating Wins app. Source of truth for
"what's next" — update as items land or priorities shift. Pair with
`TESTING.md` for the architecture snapshot.

---

## In flight / next up

### Per-user request log + rate limiting
A throwaway account (`testuser@gmail.com`, 2026-06-17) created 286 goals +
178 journal entries + 132 LC conversations + ~610 message appends in ~50
minutes via automated fuzzing — wordlist payloads (`pg_sleep`, `WAITFOR`,
template injection, `../etc/passwd`, `zap_token` markers). All landed as
inert text (parameterized inserts, Vue auto-escapes on render), so no code
path was compromised. The fuzzer ran the LC chat too — DeepSeek billed 484
requests for that day — meaning real LLM cost was incurred but our
`llm_usage` table had 0 rows for the window. We've since removed `llm_usage`
entirely (provider billing dashboards own that) and need a provider-agnostic
abuse signal instead.

What to build:
- **`request_log` table** — one row per authenticated write request:
  `user_id, route, status, created_at`. No tokens, no model. Lives in
  middleware (`backend/middleware/auth.js` after `verifyToken`) so the
  recording can't drift from reality. Backs both the admin "writes per
  hour" panel and the gateway rate limiter.
- **Server-side rate limit at the gateway.** Bursty short-window cap on
  authenticated write paths (entries, goals, conversations, append,
  `/elsie/chat`). 30 req/min as a starting default. Return 429 with a
  retry-after header.
- **Harden `POST /api/lc/conversations/:id/messages`.** Today it accepts
  `role: 'assistant'` payloads from the client — the fuzzer used this to
  fake LC replies without proof the model produced them. Restrict to
  `role: 'user'` only, and have the server append the assistant turn
  itself inside `routes/elsie.js` after the model call.
- **Admin signal.** Surface "writes per hour" on the user detail page so
  spikes are visible at a glance.

### Rich journal editor
The journal entry input is a plain `<textarea>` — fine for "today was busy"
prose, undersized for what a journal actually is. Trainers should be able
to structure an entry the way they'd structure a real journal: headings,
subheadings, bold/italic, bullet lists, paragraph breaks that render as
paragraph breaks.

Considered Google Docs embed and ruled it out: it would route raw journal
text through Google before our pseudonymization pipeline (`[[feedback-ai-privacy]]`),
which is the boundary the whole redactor + per-user pseudonym story is
built around.

Direction: swap the textarea for TipTap (Vue 3 wrapper over ProseMirror).
Open questions to settle before building:
- **Storage format.** `journal_entries.text` is `text` today. TipTap can
  serialize to HTML or to its own JSON doc. JSON preserves structure
  losslessly; HTML is easier to render in the admin inspector and for
  win-extraction prompts. Probably HTML (simple, safe to slot into the
  analyzer prompt verbatim), with strict sanitization on read.
- **Analyzer impact.** Wins extraction (`routes/wins.js`) feeds entry text
  to the LLM. Bolded / heading-tagged content is *useful* signal there —
  the model can lean on "Win: closed Q3 onboarding" as a heading. Need to
  decide whether to pass HTML through or strip to plain text on the way
  in. Keeping the tags probably yields better extractions.
- **Pseudonymization.** The redactor walks plain text today. Either run it
  on the rendered text content before sending to the model, or teach it
  to ignore tags. Cheap; the editor shouldn't change what text the model
  sees, only what the user sees.
- **Frontend NER hints.** `entityHints` is generated from typed text on
  the client. The hint extractor needs to read TipTap's JSON or
  textContent rather than `.value` of a textarea — one-line swap.

Worth the bundle cost (~30kb gzipped for TipTap core + the marks/nodes we
need). The journal page is a primary surface and it currently feels like
a form field.

### Main app UX fixes
Friction points surfaced from real use:
- **Home roadmap card** — current presentation is confusing; either redesign
  or drop in favor of a clearer "what's next" surface.
- **LC mic vs stop control** — two buttons in similar position read as one
  ambiguous toggle. Disambiguate state + intent.
- **LC post-action routing** — after LC executes a tool (e.g. "make a goal"),
  auto-navigate the user to the page where the result lives (Goals,
  Reflections, etc.) so the effect is visible.
- **In-app FAQ** — fold the user-facing FAQ surface into the app rather than
  a separate docs site, so help lives next to the feature it explains.

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

### Admin page — v2 powers
v1 shipped on `lc-modular`: role-based gating, LLM provider config, user
inspection (entries/goals/programs/reflections/LC chats), user deletion.
Next candidates, grouped by problem they solve:

- **Account management**: promote/demote admins from the UI (kills the env-var
  dance), suspend-vs-delete via `is_disabled`, trigger password-reset email on
  a user's behalf, edit a user's profile for support cases.
- **Observability**: writes-per-hour per user (from `request_log` — see
  Per-user request log section above), failed-action log (every
  `resolveActions` drop + claude error), last-active timestamp per user.
  LLM token usage was tried and removed — provider billing dashboards own
  that surface, and duplicating per-provider is fragile.
- **Quality / safety**: side-by-side LC chat view showing the pseudonymized
  payload actually sent to the model next to the rehydrated version — proves
  the redaction story works on real conversations. System-prompt editor in
  the admin UI for prompt iteration without a deploy (risky, high leverage).
- **Data**: per-user JSON export (GDPR-shaped), targeted `clear-pseudonyms`
  for a user whose registry got polluted.

Top three picks if forced to prioritize: promote/demote admins,
writes-per-hour panel, pseudonymized side-by-side chat view.

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

- LC quality pass: Tavily web search tool wired into LC with clickable inline
  citations, prompt iteration, and a budget-cap synthesis pass so LC never
  returns sources-without-prose at MAX_TOOL_HOPS.
- LC voice: ElevenLabs TTS with abort-safe playback, reactive Web Audio
  visualizer driving an aurora orb redesign.
- Cybersecurity audit remediation (cybersec-fixes branch): 11 fixed, 3
  mitigated, 2 accepted, 1 deferred; 0 npm vulnerabilities. Full per-finding
  response report in `docs/`.
- Multi-provider LLM support: Anthropic + OpenAI + Google Gemini adapters
  behind a canonical message format. OpenAI adapter also covers any
  OpenAI-compatible endpoint (Mistral/Together/Groq/Fireworks/vLLM/LM Studio)
  via custom baseUrl. Per-provider encrypted key slots so switching doesn't
  require re-entering keys.
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
