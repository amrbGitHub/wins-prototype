// redactor — PII detection + pseudonymization gateway (v1)
//
// Strategy: run a local BERT-NER model over the user's text, find entities
// (people, orgs, locations), replace each with a stable pseudonym. The
// pseudonyms are session-local for now — task #3 will swap in the persistent,
// per-user registry backed by Supabase + AES-GCM encryption.
//
// Why BERT-NER and not GLiNER: the npm `gliner` package is alpha and depends
// on outdated transformers v2. `@huggingface/transformers` v3 (already in the
// frontend) is Node-native and well-supported. We can swap in GLiNER ONNX
// weights through this same library later if we need custom entity labels.
//
// The output shape is the contract every downstream piece depends on:
//   { redactedText, mappings: [{ real, pseudonym, type, score, start, end }] }
// rehydrator and the Claude orchestrator both consume this exact shape.

const crypto = require('node:crypto')
const { supabase } = require('../config')
const { hashForUser, encryptForUser } = require('./crypto')

// Lazy-init the pipeline. Model is ~110MB on first download, cached locally
// thereafter under ~/.cache/huggingface. We init on first call, not at module
// load, so backend boot isn't blocked by the download.
let _pipelinePromise = null

async function getPipeline() {
  if (_pipelinePromise) return _pipelinePromise
  _pipelinePromise = (async () => {
    const { pipeline } = await import('@huggingface/transformers')
    return pipeline('token-classification', 'Xenova/bert-base-NER')
  })()
  return _pipelinePromise
}

// BERT-NER entity_group → our internal type. We drop MISC as it's too noisy
// for redaction (matches common nouns, dates, generic terms).
const TYPE_MAP = {
  PER:  'PERSON',
  ORG:  'ORG',
  LOC:  'LOCATION',
}

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

// Confidence threshold below which we skip the entity, per type. Tuned from
// false-positive AND false-negative cases:
//   - PERSON: ambiguous-but-real names (Jordan, Phoenix) score 0.75–0.85.
//     We need high recall here because missing a name = real PII leak.
//     The DOMAIN_STOPWORDS list catches the obvious false positives
//     (Kirkpatrick, Bloom, etc.) so we can afford the lower threshold.
//   - ORG / LOCATION: keep stricter — false positives are noisy but not
//     privacy-critical, and BERT is more confident on these when right.
const MIN_SCORE = {
  PERSON:   0.60,
  ORG:      0.80,
  LOCATION: 0.80,
}

// Domain stopwords — words BERT thinks are person/org/location names but in
// L&D context refer to frameworks, theorists, or methodologies. Even at 0.99
// confidence, these get suppressed. Lowercased for case-insensitive match.
// Extend freely; this is the cheapest way to fix domain false-positives.
const DOMAIN_STOPWORDS = new Set([
  // Learning-science theorists referenced by surname
  'bloom', 'kirkpatrick', 'phillips', 'knowles', 'ebbinghaus', 'vygotsky',
  'piaget', 'maslow', 'skinner', 'pavlov', 'gagne', 'merrill', 'mager',
  'mosher', 'gottfredson', 'wiggins', 'mctighe', 'pareto', 'dewey', 'bandura',
  // Frameworks / methodologies often capitalized like proper nouns
  'addie', 'sam', 'agile', 'lean', 'sbi',
])

// Detect PII and return mappings. Optionally pass `skipNames` — case-insensitive
// list of names that must NOT be redacted even if NER tags them. The primary
// use is the user's OWN first/full name: they're not PII to themselves, Claude
// already knows them via the system prompt, and pseudonymizing them across
// every assistant greeting ("Hey Amro!") clutters the registry with a row
// that represents the user themselves.
async function redactText(text, { skipNames = [] } = {}) {
  if (!text || typeof text !== 'string') {
    return { redactedText: text || '', mappings: [] }
  }
  const skipSet = new Set(
    skipNames.filter(Boolean).map(n => String(n).toLowerCase().trim())
  )

  const ner = await getPipeline()

  // We do our own aggregation instead of relying on aggregation_strategy:'simple'.
  // The transformers.js v3 implementation has bugs with BERT subword pieces
  // (e.g. it splits "Acme Corp" into "A" + "##cme Corp" instead of merging).
  // Walking raw tokens lets us handle the BIO scheme and ## continuations
  // correctly, and gives us per-token scores to average for confidence.
  const raw = await ner(text)

  // Group raw tokens into entity spans. A span starts at any B-XYZ (or an
  // I-XYZ with no preceding span — defensive). It continues through I-XYZ
  // tokens of the same type, OR through subword continuation tokens (## prefix
  // OR an out-of-place B-XYZ that's clearly a continuation of the same word
  // because BERT-NER's BIO labelling isn't 100% strict across subwords).
  const groups = []
  let current = null
  for (const t of raw) {
    if (!t.entity || t.entity === 'O') { current = null; continue }
    const [bio, type] = t.entity.split('-')   // e.g. "B-PER" → ["B", "PER"]
    const isSubword = t.word.startsWith('##')
    const sameType  = current && current.type === type
    const continues = sameType && (bio === 'I' || isSubword)
    if (continues) {
      current.tokens.push(t)
    } else {
      current = { type, tokens: [t] }
      groups.push(current)
    }
  }

  // For each group: filter by mapped type, average score across subwords,
  // reconstruct the entity word (strip ##, add spaces between non-continuation
  // tokens), then locate the word in the source text to recover char offsets.
  const entities = []
  let cursor = 0
  for (const g of groups) {
    const mappedType = TYPE_MAP[g.type]
    if (!mappedType) continue
    const avgScore = g.tokens.reduce((s, t) => s + t.score, 0) / g.tokens.length
    if (avgScore < MIN_SCORE[mappedType]) continue

    // Reconstruct: "A" + "##c" + "##me" + "Corp" → "Acme Corp"
    let word = ''
    for (const t of g.tokens) {
      if (t.word.startsWith('##')) word += t.word.slice(2)
      else word += (word ? ' ' : '') + t.word
    }
    if (!word) continue

    let start = text.indexOf(word, cursor)
    if (start < 0) continue  // Couldn't locate (rare punctuation case) — skip.
    let end = start + word.length

    // Word-boundary extension. BERT sometimes tags only the leading subword
    // of a name and silently drops the rest (e.g. "Hey Amro!" → only "Am"
    // tagged as B-PER, "##ro" dropped as O). Without this fix the redactor
    // captures "Am" alone, leaving "Hey Person_XXXXro!" — a leak AND broken
    // text. Extend the span rightward over any continuing letters so the
    // full word "Amro" gets captured and replaced.
    while (end < text.length && /[a-zA-Z]/.test(text[end])) end++
    // (No leftward extension — BERT's leading subword always starts at the
    //  real word boundary, so left-side truncation isn't the failure mode.)

    // Both filter checks run AFTER word-boundary extension against the actual
    // captured text. Doing them before extension misses cases like "Amro"
    // (where the captured word starts as "Am" and only matches the skip list
    // / stopwords once extension completes the word).
    const actualReal = text.slice(start, end).toLowerCase()
    if (DOMAIN_STOPWORDS.has(actualReal)) continue
    if (skipSet.has(actualReal))          continue

    entities.push({
      real:  text.slice(start, end),
      type:  mappedType,
      score: avgScore,
      start,
      end,
    })
    cursor = end
  }

  // Dedupe: same lowercase real value within this call → same pseudonym.
  const byKey = new Map()
  const mappings = []
  for (const e of entities) {
    const key = `${e.type}:${e.real.toLowerCase()}`
    let pseudonym = byKey.get(key)
    if (!pseudonym) {
      pseudonym = mintPseudonym(e.type)
      byKey.set(key, pseudonym)
    }
    mappings.push({ ...e, pseudonym })
  }

  // Right-to-left replacement preserves earlier start/end indices.
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

module.exports = { redactText, canonicalizeMappings, applyCanonicals, rehydrateText, getPipeline }
