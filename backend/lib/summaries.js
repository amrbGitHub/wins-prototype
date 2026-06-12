// summaries — encrypted per-person and per-conversation summary storage,
// plus the Haiku-powered updater that distills each turn into them.
//
// Why this exists: the gateway no longer sends raw chat history to Claude.
// Continuity comes entirely from these summaries. The privacy upside is that
// Anthropic's API only ever sees one turn at a time plus opaque pseudonymized
// summaries — never a coherent transcript.
//
// Storage:
//   pseudonym_summaries     — long-term, keyed by pseudonym_registry_id
//   conversation_summaries  — short-term, keyed by conversation_id
// Both AES-GCM encrypted with the per-user key.
//
// Update model:
//   Synchronous (awaited before the user sees the "done" event). Adds ~1-2s
//   per turn but guarantees the NEXT turn sees up-to-date context. Async with
//   serialization would be faster but adds complexity we don't need yet.

const { supabase } = require('../config')
const { encryptForUser, decryptForUser } = require('./crypto')
const { claudeChat, getSummaryModel } = require('./claude')

// The summary updater is a discrete, bounded JSON-out task — perfect for a
// faster/cheaper model than the main chat. The main chat uses the configured
// chat model; this updater routes to the configured summary model (typically
// a smaller/faster variant). Both come from app_config / env via llmConfig.

// Pseudonyms in our format always match this. Used to discover which
// pseudonyms a summary blob references so we can rehydrate Claude's response
// even when it cites a person we DIDN'T see in the current user message.
const PSEUDONYM_PATTERN = /\b(?:Person|Org|Loc|Ent)_[0-9A-F]{4}\b/g

function extractPseudonymsFromText(text) {
  if (!text) return []
  const matches = String(text).match(PSEUDONYM_PATTERN) || []
  return [...new Set(matches)]
}

// ── Fetch ────────────────────────────────────────────────────────────────────

// Returns Map<registry_id, decryptedSummary>. Missing rows = no summary yet.
async function fetchPersonSummaries(userId, registryIds) {
  if (!userId || !Array.isArray(registryIds) || !registryIds.length) return new Map()
  const { data, error } = await supabase
    .from('pseudonym_summaries')
    .select('pseudonym_registry_id, encrypted_summary')
    .in('pseudonym_registry_id', registryIds)
  if (error) throw new Error(`fetch person summaries: ${error.message}`)
  const result = new Map()
  for (const row of data || []) {
    try {
      result.set(row.pseudonym_registry_id, decryptForUser(userId, row.encrypted_summary))
    } catch (e) {
      // Skip rows that fail to decrypt (key rotation, corruption). Log but
      // don't fail the whole turn — missing context degrades gracefully.
      console.warn('[summaries] decrypt person summary failed:', e.message)
    }
  }
  return result
}

// Returns decrypted string or null if no summary yet.
async function fetchConversationSummary(userId, conversationId) {
  if (!userId || !conversationId) return null
  const { data, error } = await supabase
    .from('conversation_summaries')
    .select('encrypted_summary')
    .eq('conversation_id', conversationId)
    .maybeSingle()
  if (error) throw new Error(`fetch conversation summary: ${error.message}`)
  if (!data) return null
  try {
    return decryptForUser(userId, data.encrypted_summary)
  } catch (e) {
    console.warn('[summaries] decrypt conversation summary failed:', e.message)
    return null
  }
}

// Given a list of pseudonyms (e.g. those mentioned in summaries that Claude
// may also reference), look up their registry rows and return a map of
// pseudonym → { registryId, realValue } for use in rehydration.
async function buildReverseMappings(userId, pseudonyms) {
  const list = [...new Set(pseudonyms || [])].filter(Boolean)
  if (!list.length) return []
  const { data, error } = await supabase
    .from('pseudonym_registry')
    .select('id, pseudonym, encrypted_real_value')
    .eq('user_id', userId)
    .in('pseudonym', list)
  if (error) throw new Error(`reverse pseudonym lookup: ${error.message}`)
  const result = []
  for (const row of data || []) {
    try {
      result.push({
        registryId: row.id,
        pseudonym:  row.pseudonym,
        real:       decryptForUser(userId, row.encrypted_real_value),
      })
    } catch (e) {
      console.warn(`[summaries] decrypt real_value for ${row.pseudonym} failed:`, e.message)
    }
  }
  return result
}

// ── Update ───────────────────────────────────────────────────────────────────
//
// Single Haiku call that updates BOTH summary types in one shot. Cheaper and
// more coherent than two separate calls (the updater sees the same context for
// both outputs).
//
// Inputs are pseudonymized; outputs must also be pseudonymized (the updater
// doesn't know real names). We constrain it via the system prompt.

const SUMMARY_UPDATER_SYSTEM = `\
You are a summary maintainer for a private L&D coaching app. You will receive:

1. EXISTING PERSON SUMMARIES (one per pseudonym like Person_4F2C / Org_AD92 /
   Loc_BF08). Each is a short factual note about that entity, built up
   over many turns. May be empty for new entities.
2. EXISTING CONVERSATION SUMMARY — a short rolling note of where the current
   conversation stands. May be empty.
3. The user's latest message (pseudonymized — names replaced with Person_X etc.)
4. The assistant's response (pseudonymized).

Your job: update both, returning STRICT JSON. Rules:

- For each pseudonym in the inputs, write or update a factual person summary.
  Keep it under 250 characters. State what we know, not what we suspect.
  Don't invent details. If nothing changed, return the existing text unchanged.
- For the conversation summary, write under 250 characters describing
  WHERE we are in this conversation — what's been discussed, what the trainer
  is currently exploring. Capture conversational state so the next turn can
  resolve pronouns and "the X" references without history.
- Use pseudonyms exactly as given. Never invent new ones. Never decode them.
- Output only the JSON. No prose before or after.

Format:
{
  "personSummaries": {
    "Person_4F2C": "<updated summary>",
    "Org_AD92":    "<updated summary>"
  },
  "conversationSummary": "<updated summary>"
}`

async function updateSummaries({
  userId,
  conversationId,
  pseudonymToRegistryId,    // Map<pseudonym → registry_id>
  priorPersonSummaries,     // Map<registry_id → summary>
  priorConversationSummary, // string | null
  pseudonymizedUserMsg,
  pseudonymizedAssistantMsg,
}) {
  if (!userId) throw new Error('updateSummaries: userId required')
  if (!pseudonymToRegistryId || pseudonymToRegistryId.size === 0) {
    // No tracked entities → just maintain conversation summary, if a conversation exists.
    if (!conversationId) return
  }

  // Build the prompt context — pseudonyms grouped with their existing summaries.
  const personBlock = [...pseudonymToRegistryId.entries()]
    .map(([pseudonym, regId]) => {
      const existing = priorPersonSummaries.get(regId) || '(none yet)'
      return `${pseudonym}: ${existing}`
    })
    .join('\n')

  const userPrompt = `EXISTING PERSON SUMMARIES:
${personBlock || '(none — no tracked entities in this turn)'}

EXISTING CONVERSATION SUMMARY:
${priorConversationSummary || '(none yet — this may be the first turn)'}

USER'S LATEST MESSAGE (pseudonymized):
${pseudonymizedUserMsg}

ASSISTANT'S RESPONSE (pseudonymized):
${pseudonymizedAssistantMsg}

Return the updated JSON now.`

  let parsed
  try {
    const summaryModel = await getSummaryModel()
    const raw = await claudeChat({
      system: SUMMARY_UPDATER_SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
      // Conservative ceiling: 4 entities × ~250-char summaries + a 250-char
      // conv summary + JSON wrapping. Truncation was the root cause of the
      // prior "Unterminated string in JSON" errors; the new 250-char caps
      // give us comfortable headroom under 1500.
      maxTokens: 1500,
      temperature: 0.2,
      usageContext: { userId, conversationId, purpose: 'summary' },
      ...(summaryModel ? { model: summaryModel } : {}),
    })
    // Strip any code fences and parse
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    parsed = JSON.parse(cleaned)
  } catch (e) {
    console.warn('[summaries] updater LLM failed (non-fatal, keeping prior summaries):', e.message)
    return
  }

  // Persist person summaries — only for pseudonyms we actually know about.
  // Drop anything the model invented.
  const personRows = []
  for (const [pseudonym, summary] of Object.entries(parsed.personSummaries || {})) {
    const regId = pseudonymToRegistryId.get(pseudonym)
    if (!regId || typeof summary !== 'string' || !summary.trim()) continue
    personRows.push({
      pseudonym_registry_id: regId,
      encrypted_summary:     encryptForUser(userId, summary.trim().slice(0, 500)),
      updated_at:            new Date().toISOString(),
    })
  }
  if (personRows.length) {
    // Upsert: insert new rows, update existing. Postgres handles the version
    // bump via the trigger... actually we don't have one — increment manually
    // by reading then writing. For v1 we just overwrite — version stays 1.
    // Add a version-bump trigger later if needed for audit.
    const { error } = await supabase
      .from('pseudonym_summaries')
      .upsert(personRows, { onConflict: 'pseudonym_registry_id' })
    if (error) console.warn('[summaries] person summary upsert failed:', error.message)
  }

  // Persist conversation summary — only if we have a conversation.
  if (conversationId && typeof parsed.conversationSummary === 'string' && parsed.conversationSummary.trim()) {
    const { error } = await supabase
      .from('conversation_summaries')
      .upsert({
        conversation_id:   conversationId,
        encrypted_summary: encryptForUser(userId, parsed.conversationSummary.trim().slice(0, 500)),
        updated_at:        new Date().toISOString(),
      }, { onConflict: 'conversation_id' })
    if (error) console.warn('[summaries] conversation summary upsert failed:', error.message)
  }
}

module.exports = {
  extractPseudonymsFromText,
  fetchPersonSummaries,
  fetchConversationSummary,
  buildReverseMappings,
  updateSummaries,
  PSEUDONYM_PATTERN,
}
