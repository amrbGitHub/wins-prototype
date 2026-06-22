// claude — thin façade that dispatches to whichever LLM provider the admin
// has selected. The module name is a historical accident; it now routes to
// Anthropic, OpenAI, or Google Gemini via the providers/ adapters.
//
// All inputs to this module MUST already be pseudonymized — the gateway
// redacts before calling us. Adapters translate the canonical Anthropic-
// shaped message format into each provider's native API.

const { getProvider } = require('./providers')
const { getLlmConfig } = require('./llmConfig')

async function* claudeChatStream(args) {
  const provider = await getProvider()
  for await (const event of provider.chatStream(args, provider.cfg)) {
    // Providers may still emit `usage` events with token counts; we no longer
    // record them (see roadmap: per-user request log replaced token accounting).
    // Swallow so callers don't see plumbing they don't consume.
    if (event.type === 'usage') continue
    yield event
  }
}

async function claudeChat(args) {
  const provider = await getProvider()
  const result = await provider.chat(args, provider.cfg)
  // Adapters return { text, usage } or a plain string (legacy shape).
  if (typeof result === 'string') return result
  return result.text
}

// Resolve the summary model id from runtime config. Used by the summary
// updater to route to a cheaper model than the chat path.
async function getSummaryModel() {
  const cfg = await getLlmConfig()
  return cfg.summaryModel || cfg.chatModel
}

module.exports = { claudeChat, claudeChatStream, getSummaryModel }
