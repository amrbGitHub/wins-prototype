# Migration notes — LC Claude/DeepSeek gateway

This branch replaces the local Ollama path for LC chat with a Claude-API-compatible
gateway (currently pointed at DeepSeek for cost). PII is pseudonymized locally
before any request leaves the backend, and rehydrated before any response is
shown to the user. Per-pseudonym summaries provide cross-conversation memory.

Anyone pulling this branch (or `main` after merge) needs to do the following
**in order** before the backend will run.

---

## 1. Install new backend dependencies

```bash
cd backend
npm install
```

New deps added: `@huggingface/transformers` (NER), `@anthropic-ai/sdk`.

> First run will download the ~110 MB BERT-NER model the first time the
> redactor is invoked. Cached in `~/.cache/huggingface` after that.

## 2. Run database migrations IN ORDER

Open the Supabase SQL editor and run each migration file once, in numeric
order. All are idempotent — safe to re-run.

| File | What it adds |
|---|---|
| `backend/migrations/005_pseudonym_registry.sql` | Per-user registry mapping real values → opaque pseudonyms (encrypted at rest). |
| `backend/migrations/006_pseudonym_gc.sql` | Junction table linking conversations ↔ pseudonyms + `delete_orphan_pseudonyms()` GC function. |
| `backend/migrations/007_summaries.sql` | Encrypted summary tables (per-pseudonym + per-conversation). |

If any migration errors out partway, do NOT re-run blindly — check the error,
fix, and re-run. (They're idempotent for the cases that matter, but partial
state is partial state.)

## 3. Set env vars in `backend/.env`

```bash
# PII encryption — 32 random bytes, base64-encoded. Generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
#
# CRITICAL: never commit this. Store a copy somewhere safe (password manager).
# Losing it permanently bricks all encrypted pseudonym registry data and
# summaries for every user. There is no recovery.
PSEUDONYM_ENCRYPTION_KEY=<generate-locally-and-paste>

# Claude / DeepSeek (we currently use DeepSeek's Anthropic-compatible endpoint)
ANTHROPIC_API_KEY=<your DeepSeek or Anthropic key>
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
ANTHROPIC_MODEL=deepseek-v4-flash

# Optional: prints per-turn redaction summary to backend console for debugging
LC_GATEWAY_DEBUG=true
```

To switch back to Anthropic (Claude direct):
- Set `ANTHROPIC_API_KEY` to a real Anthropic key
- **Remove or comment out** `ANTHROPIC_BASE_URL` (so the SDK uses its default)
- Set `ANTHROPIC_MODEL` to e.g. `claude-haiku-4-5-20251001`

## 4. Restart the backend

```bash
cd backend && npm run dev
```

If env vars or migrations are missing, errors surface on the first chat turn
(not at boot — most checks are lazy). Look at the backend terminal.

---

## How the gateway works (one-paragraph summary)

Per turn: every message in chat history is redacted with a local NER model
(swapping names/orgs/places for `Person_XXXX`/`Org_XXXX`/`Loc_XXXX`),
canonicalized against a per-user encrypted registry (so the same real name
always maps to the same pseudonym across all conversations), and sent to
DeepSeek/Claude alongside the action tool definitions. The model's prose
response is rehydrated back to real names before streaming to the user; its
tool calls become action chips that execute against the user's actual goals
/programs/wins. After the turn, a synchronous Haiku call updates per-pseudonym
summaries so cross-conversation memory persists.

## Key file map

```
backend/
├── lib/
│   ├── claude.js       — Anthropic SDK wrapper, streams text + tool calls
│   ├── tools.js        — Action tool definitions
│   ├── redactor.js     — NER, redact, canonicalize, rehydrate (text + action)
│   ├── crypto.js       — Per-user AES-GCM + HMAC hashes
│   ├── summaries.js    — Fetch + Haiku-update per-pseudonym summaries
│   └── actionResolver.js — Fuzzy goalRef/programRef → real UUIDs
├── prompts/
│   └── lc-gateway.js   — System prompt (voice + L&D ref + playbooks)
├── routes/
│   └── elsie.js        — POST /api/elsie/chat — single gateway path
└── tests/
    └── redactor-suite.js — Run with: node tests/redactor-suite.js
```

## What to do if something breaks

- **Backend won't start, missing env**: see step 3 above.
- **Chat turns error with "ANTHROPIC_API_KEY is not set"**: env var isn't being
  loaded. Check `backend/.env` exists, has no UTF-16 BOM, key isn't empty.
  `dotenv` is set to `override: true` so shell env can't shadow it.
- **All chats return pseudonyms instead of real names**: rehydration path
  broken — likely the DB BYTEA hex parse. Check `lib/crypto.js` `toBuffer()`.
- **Summaries always return "no prior notes"**: either summary writes are
  failing silently (check `[summaries]` warnings in console) or the read path
  is broken. Run this in Supabase SQL editor to inspect:
  ```sql
  SELECT pr.pseudonym, ps.version, ps.updated_at,
         OCTET_LENGTH(ps.encrypted_summary) AS bytes
  FROM pseudonym_registry pr
  LEFT JOIN pseudonym_summaries ps ON ps.pseudonym_registry_id = pr.id
  WHERE pr.user_id = '<your-user-id>'
  ORDER BY pr.created_at DESC;
  ```
- **PII leak in chat payload**: extend `backend/tests/redactor-corpus.js` with
  the failing input, re-run the suite to confirm, then tune the redactor
  (`MIN_SCORE` per type or `DOMAIN_STOPWORDS` in `lib/redactor.js`).

## Open known issues (as of merge)

- Marcus-summary-not-loading: under investigation. Either write-path silently
  failing or BYTEA edge case. SQL diagnostic in the troubleshooting section
  above will narrow it down.
- Action flow (create_goal, log_win, etc. via chat) was re-wired late and
  hasn't been exhaustively tested through the UI yet — likely fine but worth
  running through each action type once after merge.
- Ollama is still required for non-LC features (auto-titling, journal
  analysis, celebration message drafting). Make sure your Ollama instance is
  reachable at `OLLAMA_BASE_URL` (default `http://localhost:11434/v1`).
