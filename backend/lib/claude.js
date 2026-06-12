// claude — thin façade that dispatches to whichever LLM provider the admin
// has selected. The module name is a historical accident; it now routes to
// Anthropic, OpenAI, or Google Gemini via the providers/ adapters.
//
// All inputs to this module MUST already be pseudonymized — the gateway
// redacts before calling us. Adapters translate the canonical Anthropic-
// shaped message format into each provider's native API.
//
// Usage accounting: callers pass an optional `usageContext`
// ({ userId, conversationId?, purpose }) and we record token counts to
// llm_usage after each call. Best-effort: a logging miss never breaks the
// user-facing AI call.

const { getProvider } = require('./providers')
const { getLlmConfig } = require('./llmConfig')
const { recordUsage } = require('./usage')

function fireAndForgetRecord(usageContext, providerName, usage) {
  if (!usageContext || !usage) return
  // Don't await — recording is non-critical and we don't want to delay the
  // response on a slow Supabase insert.
  recordUsage({
    userId:         usageContext.userId,
    conversationId: usageContext.conversationId || null,
    purpose:        usageContext.purpose || 'chat',
    provider:       providerName,
    model:          usage.model || 'unknown',
    inputTokens:    usage.inputTokens  || 0,
    outputTokens:   usage.outputTokens || 0,
  }).catch(() => {})
}

async function* claudeChatStream(args) {
  const provider = await getProvider()
  const providerName = provider.cfg?.providerType || 'anthropic'
  for await (const event of provider.chatStream(args, provider.cfg)) {
    if (event.type === 'usage') {
      fireAndForgetRecord(args.usageContext, providerName, event)
      // Swallow the event — callers don't need to know about usage plumbing.
      continue
    }
    yield event
  }
}

async function claudeChat(args) {
  const provider = await getProvider()
  const providerName = provider.cfg?.providerType || 'anthropic'
  const result = await provider.chat(args, provider.cfg)
  // Adapters now return { text, usage }. Tolerate the old shape (plain string)
  // in case a future provider hasn't been migrated yet.
  if (typeof result === 'string') return result
  fireAndForgetRecord(args.usageContext, providerName, result.usage)
  return result.text
}

// Resolve the summary model id from runtime config. Used by the summary
// updater to route to a cheaper model than the chat path.
async function getSummaryModel() {
  const cfg = await getLlmConfig()
  return cfg.summaryModel || cfg.chatModel
}

module.exports = { claudeChat, claudeChatStream, getSummaryModel }
