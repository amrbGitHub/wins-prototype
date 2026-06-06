# Tester Guide — `frontend-ner` branch

Snapshot of where the app is right now, what's new since the last round of
testing, and the rough edges you should expect to find. Pair this with
`MIGRATION_NOTES.md` if you're setting up a fresh local backend (env vars,
DB migrations).

---

## What this app is

A Vue 3 + Express prototype for L&D trainers to capture and celebrate wins of
the people they work with. Two main surfaces:

- **Journal / Celebrate tabs** — original feature set. Trainer writes a journal
  entry (typed or dictated); a local Ollama LLM extracts wins; wins are
  aggregated on the Celebrate tab and used to draft celebration messages.
- **LC chat (Elsie)** — the new conversational "L&D thinking partner." Talks
  to the trainer about their learners/programs/goals. Can take actions on
  their behalf (log a win, create a goal, create a program) via tool calls.

Both surfaces talk to the same Express backend (port 8787) and the same
Supabase project for storage. Journal/Celebrate uses Ollama (local LLM); LC
chat uses a Claude-API-compatible gateway (currently DeepSeek).

---

## What changed on this branch

### 1. PII never leaves your machine in cleartext (LC chat)

Every LC chat turn now runs through a pseudonymization pipeline before any
text is sent to the LLM provider:

- **Frontend NER** detects names/orgs/places using a local BERT-NER model
  (~110 MB, cached in IndexedDB after first load).
- The backend mints stable per-user pseudonyms (`Person_4F2C`, `Org_AD92`,
  `Loc_BF08`, `Ent_…`) and stores the real → pseudonym mapping in an
  AES-256-GCM-encrypted Supabase table, keyed per user via HKDF.
- Outgoing message → pseudonymized. LLM reply → rehydrated to real names
  before the user sees it.
- The provider only ever sees one pseudonymized turn at a time + opaque
  pseudonymized summaries. Never a coherent transcript.

**What to look for as a tester:** real names showing up in the backend
console log lines for outbound prompts. They shouldn't. Names appearing in
the UI as `Person_XXXX` instead of the real name. They shouldn't (after a
brief moment while the response arrives — see "streaming removed" below).

### 2. Streaming removed (LC chat)

LC chat used to stream responses token-by-token. We turned this off because
the rehydrator couldn't keep up — you'd briefly see pseudonyms flash on
screen before being replaced. Now LC sends one complete response per turn.

Expect a slightly longer "thinking" pause and then the full reply at once.
No more real-time name flicker.

### 3. Per-pseudonym + per-conversation memory

Continuity across turns and conversations comes from two summary tables, not
from raw chat history:

- `pseudonym_summaries` — long-term per-person notes ("Person_4F2C is a
  recent hire on the onboarding program, struggling with X…").
- `conversation_summaries` — short rolling note of where the current
  conversation stands.

Both encrypted. Updated after each turn by a small JSON-out LLM call. The
main chat model never sees raw history, only these summaries.

### 4. Summary updater moved to DeepSeek v4 Flash

The main LC voice runs on DeepSeek v4 Pro. The per-turn summary update is a
bounded JSON-out task, so it's routed to Flash (faster + cheaper). This
keeps Pro focused on the conversational reply.

Configured via two env vars: `ANTHROPIC_MODEL=deepseek-v4-pro` and
`SUMMARY_MODEL=deepseek-v4-flash`. See `backend/.env.example`.

### 5. Tightened LC behavior rules

LC was occasionally:
- Firing the same `log_win` tool twice for the same person.
- Treating "okay good", "thanks" etc. as instructions to act.
- Responding with an action call and empty prose (silent reply).

Hard rules added to the system prompt to stop this. Watch for regressions.

### 6. Fixes you won't see directly but matter

- **BYTEA encoding bug.** `supabase-js` was JSON-stringifying encrypted
  Buffers, which corrupted every encrypted row. Fixed by writing
  `\x<hex>` strings directly. Old rows written before this fix are
  un-decryptable — they're skipped silently and overwritten on the next
  successful update. If you have weird "missing memory" symptoms on an
  old account, that's why; new conversations should be clean.
- **Summary updater token ceiling** bumped from 800 → 2000 to stop JSON
  truncation errors when many entities were in scope.
- **Console logs** for per-message PII are now labeled `IN THIS MSG:` with
  `[new]` / `[seen]` tags per entity, instead of the misleading `NEW PII`.

---

## Architecture at a glance

```
┌─ Frontend (Vue 3, Vite, Vercel) ────────────────────────────┐
│  Tabs: Journal, Celebrate, LC chat (Elsie)                  │
│  Local NER for LC chat (HuggingFace BERT, IndexedDB cache)  │
└────────────┬─────────────────────────────┬──────────────────┘
             │ Supabase auth + RLS         │
             ▼                             ▼
┌─ Backend (Express, Render) ─────────────────────────────────┐
│  /api/entries, /api/goals, /api/programs   → Supabase       │
│  /api/analyze*, /api/draft, /api/generate* → Ollama (local) │
│  /api/elsie/chat                                            │
│     • frontend redaction hints → backend canonicalization   │
│     • pseudonymized turn → DeepSeek v4 Pro                  │
│     • response → rehydrate → return JSON                    │
│     • async summary update → DeepSeek v4 Flash              │
│     • tool calls → action resolver → Supabase mutations     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌─ Ollama (local llama3.2 via ngrok tunnel) ─┐
              │  Powers Journal/Celebrate analyzers only.  │
              │  Must be started manually:                 │
              │    $env:OLLAMA_HOST="0.0.0.0"; ollama serve│
              └────────────────────────────────────────────┘
```

Storage:
- **Supabase** — auth, journal entries, goals, programs, reflections,
  LC conversations, pseudonym registry, encrypted summaries.
- **localStorage** — legacy fallback for the original journal data shape;
  most live data is now in Supabase.
- **IndexedDB** — cached NER model weights on the frontend.

---

## Quick test plan

If you only have 15 minutes, walk through this:

1. **Journal → Celebrate flow** (the original loop)
   - Add a journal entry that mentions a person by name and describes
     something they did well.
   - Confirm a win appears under that person on the Celebrate tab.
   - Generate a celebration message; check the channel/tone toggles.

2. **LC chat — first message** (PII pipeline)
   - Open the LC chat (Elsie) tab.
   - Wait for the NER model to load (one-time, ~10–30s; status visible).
   - Say something like "I want to celebrate Marcus, he just nailed his
     first facilitation."
   - Backend console should show pseudonyms in the outbound prompt and
     real names in the rehydrated reply.

3. **LC chat — memory** (summary path)
   - In the same conversation, ask a follow-up that refers to "he" or
     "Marcus" again. LC should resolve without you re-introducing.
   - Start a NEW conversation. Mention Marcus again. LC should
     reference what it knows about him (cross-conversation memory via
     `pseudonym_summaries`).

4. **LC chat — actions**
   - Ask LC to log the win. Confirm it appears under Marcus on the
     Celebrate tab.
   - Ask LC to create a goal or program. Confirm it appears on the
     respective tab.
   - Send a follow-up like "okay good" or "thanks." LC should NOT
     re-fire the same tool.

5. **LC chat — clearing memory**
   - Use the "Clear LC memory" button (if visible in your build) and
     verify a new conversation starts cold.

---

## Known rough edges

- **First NER load is slow.** ~110 MB model download on first LC chat
  session per browser. Subsequent loads come from IndexedDB.
- **Some LC commands still misbehave.** Specifically around editing or
  deleting existing goals/programs by reference. Being tracked separately;
  out of scope for this round.
- **No streaming** in LC chat — by design. If LC feels slow, that's the
  full-turn round-trip plus the rehydration step.
- **Old encrypted rows from before the BYTEA fix** are not recoverable.
  Symptoms: LC "forgetting" people it used to know about. Workaround:
  start a new conversation about that person; the registry will rebuild
  on the next successful turn.
- **Ollama must be running locally** for Journal/Celebrate analysis to
  work. Backend reports `llmStatus` — check that indicator in the UI
  before assuming a bug.

---

## Reporting issues

When filing a bug, please include:
- Branch (`frontend-ner` for now, `main` after this merges).
- Surface (Journal / Celebrate / LC chat).
- Whether the user message contained any real names.
- Backend console log slice if you have it (it now labels `IN THIS MSG:`
  PII clearly — that line is the most useful starting point).
- Browser (Chrome/Edge recommended; Safari/Firefox not tested for STT/NER).
