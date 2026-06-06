// redactor — PII pseudonymization + canonicalization gateway.
//
// Entity DETECTION runs on the frontend (frontend/src/lib/redactor.js) — the
// browser loads the BERT-NER model and emits entity hints per message. This
// backend module no longer loads any ML model. The 400MB+ memory footprint
// the NER pipeline used to add to every Render instance is gone.
//
// What stays here:
//   - redactFromHints(): pure string operation that turns entity hints into a
//     pseudonymized text + mapping payload. Mints fresh session-local
//     pseudonyms; canonicalization against the registry happens after.
//   - canonicalizeMappings(): per-user encrypted registry lookup. Stable
//     pseudonyms across conversations.
//   - applyCanonicals(): rewrites redacted text to use canonical pseudonyms.
//   - rehydrateText() / rehydrateAction(): pseudonyms → real names for the
//     user-visible response and any action payloads.

const crypto = require('node:crypto')
const { supabase } = require('../config')
const { hashForUser, encryptForUser } = require('./crypto')

// Pseudonym format: TypeShort_XXXX where XXXX is 4 random hex chars.
// Chosen to be (a) obviously fake, (b) short enough that Claude won't mangle
// it, (c) consistent prefix so we can grep for stragglers in tests.
const TYPE_PREFIX = {
  PERSON:   'Person',
  ORG:      'Org',
  LOCATION: 'Loc',
}

function mintPseudonym(type) {
  const id = crypto.randomBytes(2).toString('hex').toUpperCase()
  return `${TYPE_PREFIX[type] || 'Ent'}_${id}`
}

// Validate the hint payload coming in from the frontend. Frontend NER could
// in theory be tampered with by a malicious client, so we don't trust it
// blindly — but the worst a bad hint can do is produce nonsense pseudonyms
// or fail to redact something. Real PII protection still relies on the
// frontend doing its job; backend's job is to be deterministic and not crash.
function isValidHint(h, textLength) {
  return h
      && typeof h.real === 'string' && h.real.length > 0
      && typeof h.start === 'number' && Number.isInteger(h.start) && h.start >= 0
      && typeof h.end   === 'number' && Number.isInteger(h.end)   && h.end > h.start && h.end <= textLength
      && (h.type === 'PERSON' || h.type === 'ORG' || h.type === 'LOCATION')
}

// Turn frontend entity hints into the same shape the old in-process NER
// produced: { redactedText, mappings: [{real, pseudonym, type, start, end}] }.
//
// Pure function — no model load, no network call, no async. Just sorts hints
// by start index, mints a fresh pseudonym per unique (type, lowercased-real),
// and does right-to-left string slicing.
//
// `skipNames` is honoured server-side too (defensive — frontend should also
// pre-filter, but if a hint slips through for the user's own name, drop it
// here so the registry stays clean).
function redactFromHints(text, hints, { skipNames = [] } = {}) {
  if (!text || typeof text !== 'string') {
    return { redactedText: text || '', mappings: [] }
  }
  if (!Array.isArray(hints) || hints.length === 0) {
    return { redactedText: text, mappings: [] }
  }

  const skipSet = new Set(
    skipNames.filter(Boolean).map(n => String(n).toLowerCase().trim())
  )

  // Sort by start ascending so dedup happens in document order, then we'll
  // do the actual string replacement right-to-left.
  const valid = hints
    .filter(h => isValidHint(h, text.length))
    .filter(h => !skipSet.has(h.real.toLowerCase()))
    .filter(h => text.slice(h.start, h.end) === h.real)   // hint must still match text
    .sort((a, b) => a.start - b.start)

  // Same lowercased (type, real) within this message → same pseudonym.
  const byKey = new Map()
  const mappings = []
  for (const h of valid) {
    const key = `${h.type}:${h.real.toLowerCase()}`
    let pseudonym = byKey.get(key)
    if (!pseudonym) {
      pseudonym = mintPseudonym(h.type)
      byKey.set(key, pseudonym)
    }
    mappings.push({
      real:  h.real,
      type:  h.type,
      start: h.start,
      end:   h.end,
      pseudonym,
    })
  }

  // Right-to-left rewrite preserves earlier indices.
  let redactedText = text
  for (let i = mappings.length - 1; i >= 0; i--) {
    const m = mappings[i]
    redactedText = redactedText.slice(0, m.start) + m.pseudonym + redactedText.slice(m.end)
  }
  return { redactedText, mappings }
}

// ── Persistence: canonicalize session-local pseudonyms via the per-user registry ──
//
// `redactText` mints throwaway pseudonyms inside a single call. The real value
// of pseudonymization comes from PERSISTENCE: "James" should map to the SAME
// pseudonym across every conversation this user has, so Claude can maintain
// continuity (and the future summary store can attach to a stable id) without
// ever seeing the real name.
//
// Algorithm:
//   1. Dedupe mappings by (type, lowercased-real).
//   2. Hash each unique real value (HMAC-keyed by master + user).
//   3. Batch-look-up the registry in one round-trip.
//   4. For existing rows: use the persisted pseudonym.
//   5. For new rows: keep redactText's call-local pseudonym and persist
//      (encrypted real value + hash + pseudonym). Race-safe via ON CONFLICT —
//      a parallel writer that inserted first wins; we re-read to pick it up.
//
// Returns:
//   {
//     canonicalsByKey:  Map<`${type}:${lowercased-real}` → canonical pseudonym>,
//     registryIdsByKey: Map<`${type}:${lowercased-real}` → registry row UUID>,
//   }
// Callers use canonicalsByKey to rewrite text, registryIdsByKey to maintain
// the per-conversation junction table for GC.
async function canonicalizeMappings(userId, mappings) {
  if (!userId) throw new Error('canonicalizeMappings: userId required')
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return { canonicalsByKey: new Map(), registryIdsByKey: new Map() }
  }

  // Dedupe by (type, real) — same real value can appear in many messages.
  const byKey = new Map()
  for (const m of mappings) {
    const key = `${m.type}:${m.real.toLowerCase()}`
    if (!byKey.has(key)) byKey.set(key, { ...m, hash: hashForUser(userId, m.real) })
  }
  const uniques = [...byKey.values()]
  const hashes  = uniques.map(u => u.hash)

  const { data: existing, error: selErr } = await supabase
    .from('pseudonym_registry')
    .select('id, real_value_hash, pseudonym')
    .eq('user_id', userId)
    .in('real_value_hash', hashes)
  if (selErr) throw new Error(`pseudonym registry lookup failed: ${selErr.message}`)

  const persisted = new Map((existing || []).map(r => [r.real_value_hash, r]))

  const toInsert = []
  for (const u of uniques) {
    const hit = persisted.get(u.hash)
    if (hit) {
      u.canonical = hit.pseudonym
      u.registryId = hit.id
    } else {
      u.canonical = u.pseudonym
      toInsert.push({
        user_id:              userId,
        real_value_hash:      u.hash,
        encrypted_real_value: encryptForUser(userId, u.real),
        pseudonym:            u.canonical,
        entity_type:          u.type,
      })
    }
  }

  if (toInsert.length) {
    const { error: insErr } = await supabase
      .from('pseudonym_registry')
      .upsert(toInsert, { onConflict: 'user_id,real_value_hash', ignoreDuplicates: true })
    if (insErr) throw new Error(`pseudonym registry insert failed: ${insErr.message}`)

    // Re-read to pick up IDs (and to resolve any race-condition conflicts).
    const { data: reread, error: rereadErr } = await supabase
      .from('pseudonym_registry')
      .select('id, real_value_hash, pseudonym')
      .eq('user_id', userId)
      .in('real_value_hash', toInsert.map(r => r.real_value_hash))
    if (rereadErr) throw new Error(`pseudonym registry re-read issue: ${rereadErr.message}`)
    for (const r of reread || []) persisted.set(r.real_value_hash, r)
    for (const u of uniques) {
      const winner = persisted.get(u.hash)
      if (winner) { u.canonical = winner.pseudonym; u.registryId = winner.id }
    }
  }

  const canonicalsByKey  = new Map()
  const registryIdsByKey = new Map()
  for (const [key, u] of byKey) {
    canonicalsByKey.set(key, u.canonical)
    if (u.registryId) registryIdsByKey.set(key, u.registryId)
  }
  return { canonicalsByKey, registryIdsByKey }
}

// Rewrite a redacted text to use canonical pseudonyms. The text was produced
// by `redactText` with throwaway pseudonyms; this swaps each one for its
// canonical equivalent from the registry. Identity transform for new entities.
function applyCanonicals(redactedText, mappings, canonicalsByKey) {
  if (!redactedText || !Array.isArray(mappings) || !mappings.length) return redactedText
  let out = redactedText
  for (const m of mappings) {
    const canonical = canonicalsByKey.get(`${m.type}:${m.real.toLowerCase()}`)
    if (canonical && canonical !== m.pseudonym) {
      out = out.split(m.pseudonym).join(canonical)
    }
  }
  return out
}

// ── Rehydration ─────────────────────────────────────────────────────────────
// Reverse of redaction: replace pseudonyms in text back with their real values.
// Used on Claude's response before showing it to the user.
//
// Implementation notes:
//   - Word-boundary regex (\b) handles possessives naturally: "Person_4F2C's
//     idea" becomes "James's idea" because we replace just "Person_4F2C", the
//     "'s" stays in place.
//   - We sort by pseudonym length descending so if two pseudonyms ever share
//     a prefix (shouldn't happen with our format, but cheap insurance), the
//     longer one is replaced first.
//   - Idempotent — running on already-rehydrated text is a no-op because
//     pseudonyms won't be there to match.
function rehydrateText(text, mappings) {
  if (!text || typeof text !== 'string') return text || ''
  if (!Array.isArray(mappings) || mappings.length === 0) return text

  // Dedupe by pseudonym (same person referenced multiple times in input).
  const byPseudonym = new Map()
  for (const m of mappings) if (m.pseudonym && m.real) byPseudonym.set(m.pseudonym, m.real)

  let result = text
  const sorted = [...byPseudonym.entries()].sort((a, b) => b[0].length - a[0].length)
  for (const [pseudonym, real] of sorted) {
    const escaped = pseudonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(`\\b${escaped}\\b`, 'g'), real)
  }
  return result
}

// ── Action-payload rehydration ──────────────────────────────────────────────
// When the model emits a tool_use action, every text field in the payload may
// contain pseudonyms (e.g. create_goal.title = "Coach Person_4F2C on feedback").
// Before the action executes against the user's DB we swap them back to real
// names so the goals/wins/etc table holds plaintext, not opaque tokens.
//
// Pure function — returns a new action object, never mutates the input.
// Operates only on known text fields per action type; ignores unknown fields.
const ACTION_TEXT_FIELDS = {
  create_goal:    ['title', 'description', 'programRef'],
  update_goal:    ['title', 'description', 'goalRef'],
  delete_goal:    ['goalRef', 'title'],
  log_win:        ['title', 'story', 'evidence', 'programRef'],
  create_program: ['name', 'description'],
  navigate:       ['label'],
}

function rehydrateAction(action, mappings) {
  if (!action || typeof action !== 'object' || !action.type) return action
  const fields = ACTION_TEXT_FIELDS[action.type] || []
  const out = { ...action }
  for (const field of fields) {
    if (typeof out[field] === 'string') {
      out[field] = rehydrateText(out[field], mappings)
    }
  }
  // celebrationIdeas is an array of strings on log_win.
  if (action.type === 'log_win' && Array.isArray(out.celebrationIdeas)) {
    out.celebrationIdeas = out.celebrationIdeas.map(s =>
      typeof s === 'string' ? rehydrateText(s, mappings) : s
    )
  }
  return out
}

module.exports = {
  redactFromHints, canonicalizeMappings, applyCanonicals,
  rehydrateText, rehydrateAction,
}
