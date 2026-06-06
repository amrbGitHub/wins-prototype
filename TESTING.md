# Architecture Reference

Snapshot of the system as it stands on `main`. Pair with `MIGRATION_NOTES.md`
for env vars and DB migration order. This document describes how the pieces
fit together; it does not prescribe what to test or in what order.

---

## Surfaces

The app has two distinct user-facing surfaces, sharing the same Express
backend (port 8787) and the same Supabase project for storage.

**Journal / Celebrate** — original feature set. A trainer writes a journal
entry (typed or dictated); a local Ollama LLM extracts wins from the entry.
Wins aggregate on the Celebrate tab and feed celebration-message drafts.

**LC chat (Elsie)** — conversational "L&D thinking partner." Talks to the
trainer about their learners, programs, and goals. Can take actions on
their behalf (log a win, create/update/delete a goal, create a program)
through tool calls resolved server-side.

---

## LC chat data flow

```
┌─ Frontend (Vue 3, Vite, Vercel) ─────────────────────────────┐
│  • Local NER detects entities in the user's message before   │
│    it leaves the browser (HuggingFace BERT, ~110 MB,         │
│    cached in IndexedDB after first load).                    │
│  • Entity hints attached to every outbound message.          │
└────────────┬─────────────────────────────────────────────────┘
             │ Supabase auth (Bearer JWT)
             ▼
┌─ Backend (Express, Render) ──────────────────────────────────┐
│  POST /api/elsie/chat                                        │
│    1. Canonicalize entity hints → pseudonyms                 │
│       (per-user registry, AES-256-GCM at rest)               │
│    2. Pseudonymize the message + load encrypted summaries    │
│    3. Send pseudonymized turn to DeepSeek v4 Pro             │
│       (Anthropic-compatible endpoint)                        │
│    4. Rehydrate pseudonyms → real names in the response      │
│    5. Return JSON: { message, actions, dropped }             │
│    6. Async: route per-turn summary update to DeepSeek v4    │
│       Flash, persist encrypted into Supabase                 │
│    7. Tool calls → action resolver → Supabase mutations      │
└──────────────────────────────────────────────────────────────┘
```

DeepSeek (or any Anthropic-compatible provider) only ever sees one
pseudonymized turn at a time plus opaque pseudonymized summaries. It never
sees a coherent transcript and never sees real names.

---

## PII pseudonymization

Three storage tables, all per-user, all keyed by Supabase `auth.users.id`:

| Table | Purpose | Encryption |
|---|---|---|
| `pseudonym_registry` | real value → pseudonym (`Person_4F2C`, `Org_AD92`, `Loc_BF08`, `Ent_…`) | `encrypted_real_value` AES-256-GCM; lookup by `real_value_hash` (HMAC-SHA256, per-user salt) |
| `pseudonym_summaries` | long-term per-person factual notes | `encrypted_summary` AES-256-GCM |
| `conversation_summaries` | rolling per-conversation state | `encrypted_summary` AES-256-GCM |

The master AES key (`PSEUDONYM_ENCRYPTION_KEY`) is fed through HKDF with the
user's UUID as info to produce a per-user data key. Loss of the master key
permanently bricks every encrypted row across all three tables.

Wire format: `encryptForUser` returns `'\x<hex>'` strings rather than raw
Buffers, because `supabase-js` JSON-stringifies Buffers and corrupts BYTEA
writes. This is the format Postgres expects for BYTEA literals.

---

## Memory model

The LLM is stateless — no chat history is sent on subsequent turns. Continuity
comes from two summary types:

- **Per-pseudonym summaries** — what we know about each person/org/place,
  evolving across conversations. Updated after every turn that mentions
  them. Cap: 400 chars per entity.
- **Per-conversation summaries** — rolling description of where this
  conversation stands. Used by the model to resolve pronouns and "the X"
  references on the next turn.

Both are written by a small JSON-out updater call. The updater runs on
DeepSeek v4 Flash (`SUMMARY_MODEL` env) to keep the main chat model
(`ANTHROPIC_MODEL`, currently DeepSeek v4 Pro) focused on the conversational
reply. Updater receives the prior summaries + the current pseudonymized
turn, emits updated summaries as strict JSON, and the server persists them
back into the encrypted tables.

Cascade behavior:
- `pseudonym_summaries` cascades on `pseudonym_registry` delete.
- `conversation_summaries` cascades on `lc_conversations` delete.
- A clean-slate wipe deletes the parent rows; children go with them.

---

## Actions and tool calls

LC exposes a small set of tools the model can call mid-conversation:

| Tool | Effect |
|---|---|
| `create_goal` | Insert into `goals`. |
| `update_goal` | Patch a goal by fuzzy reference (title/status/progress/rename). |
| `delete_goal` | Delete a goal by fuzzy reference. |
| `log_win` | Insert a journal entry attributed to a person. |
| `create_program` | Insert a program (requires ≥2 shape signals to avoid hallucinated programs). |
| `navigate` | Frontend-only — does not auto-execute; renders a button. |

The action resolver runs server-side after the model responds and before
the response goes back to the frontend. It does fuzzy matching
(exact → contains → tokens) against the user's existing goals/programs,
attaches a `_state` field per action (`pending`/`done`/`error`/`idle`), and
includes a `dropped[]` list when the model invented references that
couldn't be resolved.

Hard rules baked into the system prompt prevent: duplicate tool calls for
the same protagonist, treating acknowledgements ("okay", "thanks") as
instructions to act, and silent replies (action call with empty prose).

---

## Streaming policy

LC chat does **not** stream tokens. Earlier streaming caused rehydrated
pseudonyms to flash visibly on screen as chunk boundaries split pseudonym
tokens or pluralization broke the `\bPSEUDO\b` regex. The endpoint now
returns one complete JSON response per turn after redaction, model call,
and rehydration are all complete.

The thinking-verb status indicator in the chat UI is cosmetic — the phases
under the hood (NER → backend redact → DeepSeek → rehydrate) aren't
individually surfaced to the frontend; the verb just cycles for vibes
during the wait.

---

## Account & privacy operations

`POST /api/account/clean-slate` (auth-scoped, password re-verified) deletes:

1. `goals`, `journal_entries`, `reflections`
2. `lc_conversations` (cascades `conversation_summaries` +
   `lc_conversation_pseudonyms`)
3. `programs`
4. `pseudonym_registry` (cascades `pseudonym_summaries`)

The auth account and `profiles` row are intentionally preserved. Password
re-entry is required server-side via a fresh Supabase client calling
`signInWithPassword` — a valid session token alone is not sufficient.

---

## Storage layers

- **Supabase Postgres** — auth, journal entries, goals, programs,
  reflections, LC conversations, pseudonym registry, encrypted summaries.
  All user-scoped tables have RLS policies enforced (`auth.uid() = user_id`
  or transitive via FK).
- **localStorage** — legacy fallback for the original journal data shape.
- **IndexedDB** — cached NER model weights on the frontend (one-time
  ~110 MB download per browser profile).

---

## Deployment topology

- **Frontend**: Vercel.
- **Backend**: Render (`render.yaml` declares env-var names with
  `sync: false`; values are set per-environment).
- **Ollama**: runs locally on the developer's machine, exposed to Render
  via an ngrok tunnel (`OLLAMA_BASE_URL`). Journal/Celebrate analyzers
  depend on this; LC chat does not.
- **DeepSeek (or any Anthropic-compatible API)**: configured via
  `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY`. The same env vars
  point the SDK at Anthropic directly if `ANTHROPIC_BASE_URL` is unset.

---

## Caveats worth knowing

- **Old encrypted rows** written before the BYTEA fix are not recoverable.
  They're skipped silently on decrypt and overwritten on the next successful
  summary update.
- **NER first-load latency** is the model weights deserializing from
  IndexedDB (warm cache) or downloading from HuggingFace (cold cache).
  Subsequent LC turns within the same session skip this cost.
- **Ollama must be running** for Journal/Celebrate analysis. The backend
  surfaces an `llmStatus` indicator the frontend checks before assuming a
  silent failure is a bug.
- **`PSEUDONYM_ENCRYPTION_KEY` rotation** has no migration path. Any rotation
  bricks every encrypted row.
- **Dev and prod sharing the same Supabase project** must share the same
  encryption key. The default config does share it.
