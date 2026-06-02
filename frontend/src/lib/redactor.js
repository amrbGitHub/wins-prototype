// Frontend NER for the LC gateway. Runs in the user's browser via
// @huggingface/transformers (already a dep for Whisper STT). Detects PII
// entities in chat text and produces entity hints that travel with each
// message to the backend, where they're used for pseudonymization without
// requiring the backend to load any model itself.
//
// The detection logic mirrors backend/lib/redactor.js exactly — same model,
// same thresholds, same stopwords. If they ever diverge, swap them through
// a shared package; for now we duplicate the policy and keep it under tight
// review.
//
// Public API:
//   detectEntities(text, { skipNames }) → { entities: [{real, type, start, end, score}] }
//   rehydrateText(text, mappings)       → text (for streamed assistant replies)
//   getPipeline()                       → preload hook; call early to warm cache
//
// Output `entities` is the entityHints payload — no pseudonyms (those are
// server-side, minted by the canonicalization step against the registry).

import { pipeline } from '@huggingface/transformers'

// ── Pipeline lazy-init ──────────────────────────────────────────────────────
// First call downloads the ~110MB BERT-NER model and caches it in
// IndexedDB. Subsequent page loads are instant.
let _pipelinePromise = null

export function getPipeline() {
  if (_pipelinePromise) return _pipelinePromise
  _pipelinePromise = pipeline('token-classification', 'Xenova/bert-base-NER')
  return _pipelinePromise
}

// ── Policy (must stay in lockstep with backend/lib/redactor.js) ─────────────
const TYPE_MAP = { PER: 'PERSON', ORG: 'ORG', LOC: 'LOCATION' }

const MIN_SCORE = {
  PERSON:   0.60,
  ORG:      0.80,
  LOCATION: 0.80,
}

const DOMAIN_STOPWORDS = new Set([
  // L&D theorists by surname
  'bloom', 'kirkpatrick', 'phillips', 'knowles', 'ebbinghaus', 'vygotsky',
  'piaget', 'maslow', 'skinner', 'pavlov', 'gagne', 'merrill', 'mager',
  'mosher', 'gottfredson', 'wiggins', 'mctighe', 'pareto', 'dewey', 'bandura',
  // Frameworks / methodologies often capitalized like proper nouns
  'addie', 'sam', 'agile', 'lean', 'sbi',
])

// ── Detection ───────────────────────────────────────────────────────────────
//
// Returns hint objects only — no pseudonyms. The backend canonicalizes against
// its per-user registry and mints stable pseudonyms there.
//
// Algorithm matches the backend:
//   1. Run BERT-NER over the text (raw token output, no aggregation)
//   2. Group raw tokens into entity spans via the BIO scheme + ## subword rule
//   3. Average per-token scores for confidence; drop low-score entities
//   4. Reconstruct entity word from subword pieces, locate in source text
//   5. Extend right over continuing letters (handles BERT-truncated names
//      like "Am" → "Amro" — see backend comments for the full story)
//   6. Filter by DOMAIN_STOPWORDS and caller-provided skipNames
export async function detectEntities(text, { skipNames = [] } = {}) {
  if (!text || typeof text !== 'string') return { entities: [] }

  const skipSet = new Set(
    skipNames.filter(Boolean).map(n => String(n).toLowerCase().trim())
  )

  const ner = await getPipeline()
  const raw = await ner(text)

  // Group raw tokens into spans
  const groups = []
  let current = null
  for (const t of raw) {
    if (!t.entity || t.entity === 'O') { current = null; continue }
    const [bio, type] = t.entity.split('-')
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
    if (start < 0) continue
    let end = start + word.length

    // Word-boundary extension — see backend comments for the Amro case.
    while (end < text.length && /[a-zA-Z]/.test(text[end])) end++

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

  return { entities }
}

// ── Rehydration ─────────────────────────────────────────────────────────────
// Reverse of redaction: replace pseudonyms in text back with real names.
// Used while streaming assistant responses so the live preview shows real
// names instead of Person_XXXX. The backend ALSO rehydrates on the server
// side (the `done` event carries the final rehydrated message), but the
// streaming deltas are pseudonymized — frontend rehydrates them on the fly.
//
// Implementation mirrors backend/lib/redactor.js.
export function rehydrateText(text, mappings) {
  if (!text || typeof text !== 'string') return text || ''
  if (!Array.isArray(mappings) || mappings.length === 0) return text

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
