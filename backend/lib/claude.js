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
  yield* provider.chatStream(args, provider.cfg)
}

async function claudeChat(args) {
  const provider = await getProvider()
  return provider.chat(args, provider.cfg)
}

// Resolve the summary model id from runtime config. Used by the summary
// updater to route to a cheaper model than the chat path.
async function getSummaryModel() {
  const cfg = await getLlmConfig()
  return cfg.summaryModel || cfg.chatModel
}

module.exports = { claudeChat, claudeChatStream, getSummaryModel }
