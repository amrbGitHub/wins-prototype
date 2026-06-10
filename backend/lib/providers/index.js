// LLM provider factory + canonical interface.
//
// Each provider adapter exposes a small surface:
//
//   chatStream({ system, messages, tools, model, maxTokens, temperature })
//     async generator yielding
//       { type: 'text', text: '<delta>' }   text chunks
//       { type: 'tools', tools: [{name, input}] }   collected at stream end
//
//   chat({ system, messages, model, maxTokens, temperature })
//     returns full text string. Used by the summary updater (no tools).
//
// Canonical input shape — Anthropic-flavored because it carries the most
// structure; other adapters down-convert into their own native formats:
//
//   system    : string OR [{ type: 'text', text, cache_control? }]
//   messages  : [{
//                 role: 'user' | 'assistant',
//                 content: string OR Array<
//                   { type: 'text', text } |
//                   { type: 'tool_use', id, name, input } |
//                   { type: 'tool_result', tool_use_id, content }
//                 >
//               }]
//   tools     : [{ name, description, input_schema }]  // Anthropic tool format
//
// All adapters MUST honour the tool_use/tool_result loop reconstruction the
// gateway already does — that's the mechanism that prevents duplicate tool
// emission across providers.

const { getLlmConfig } = require('../llmConfig')

const PROVIDERS = {
  anthropic: () => require('./anthropic'),
  openai:    () => require('./openai'),
  google:    () => require('./google'),
}

function isSupportedProvider(name) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, name)
}

// Resolve the active provider from the current LLM config. Adapter modules
// are required lazily so installing all three SDKs isn't required if the
// user only plans to use one.
async function getProvider() {
  const cfg = await getLlmConfig()
  const name = cfg.providerType || 'anthropic'
  if (!isSupportedProvider(name)) {
    throw new Error(`Unknown LLM provider "${name}". Supported: ${Object.keys(PROVIDERS).join(', ')}.`)
  }
  if (!cfg.apiKey) {
    throw new Error(
      `No API key configured for provider "${name}". ` +
      `Set one in Admin → LLM Provider, or via the relevant env var.`
    )
  }
  const mod = PROVIDERS[name]()
  return { ...mod, cfg }
}

module.exports = { getProvider, isSupportedProvider, PROVIDERS: Object.keys(PROVIDERS) }
