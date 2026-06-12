// llm_usage recorder — append-only per-call token accounting.
// Called from lib/claude.js after each provider response that exposes token
// counts. Silent best-effort: a recording failure must never break a user-
// facing AI call, so we log and swallow.

const { supabase } = require('../config')

async function recordUsage({
  userId,
  conversationId = null,
  purpose,           // 'chat' | 'summary' | 'analyzer'
  provider,
  model,
  inputTokens  = 0,
  outputTokens = 0,
}) {
  if (!userId || !purpose || !provider || !model) return
  if (!inputTokens && !outputTokens) return  // nothing meaningful to record
  try {
    const { error } = await supabase.from('llm_usage').insert({
      user_id:         userId,
      conversation_id: conversationId,
      purpose,
      provider,
      model,
      input_tokens:    inputTokens  | 0,
      output_tokens:   outputTokens | 0,
    })
    if (error) console.warn('[usage] insert failed (non-fatal):', error.message)
  } catch (err) {
    console.warn('[usage] recordUsage threw (non-fatal):', err.message)
  }
}

module.exports = { recordUsage }
