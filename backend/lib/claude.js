// claude — thin wrapper around the Anthropic SDK for the PII-gateway LC route.
//
// Design notes:
//   - All inputs to this module MUST already be pseudonymized. We don't
//     redact here; that's the gateway's job before calling us.
//   - We use prompt caching on the system prompt — the LC system prompt is
//     long-ish and identical across turns, so caching saves ~80% of input cost.
//   - Streaming is exposed as an async generator yielding text deltas, matching
//     the shape `routes/elsie.js` already expects from `ollamaChatStream`.
//   - Model + temperature defaults are tuned for L&D coaching: Haiku 4.5 is
//     cheap+capable, temp 0.4 is conversational but not unhinged.

const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk')

const DEFAULT_MODEL       = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001'
const DEFAULT_MAX_TOKENS  = Number(process.env.ANTHROPIC_MAX_TOKENS || 1024)
const DEFAULT_TEMPERATURE = Number(process.env.ANTHROPIC_TEMPERATURE || 0.4)

let _client = null
function getClient() {
  if (_client) return _client
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set in env. Get one from https://console.anthropic.com/ and add to backend/.env'
    )
  }
  _client = new Anthropic({ apiKey })
  return _client
}

// Async generator: yields text deltas as Claude streams its response.
// Caller is responsible for ensuring `messages` contains only pseudonymized
// content — we don't redact here.
async function* claudeChatStream({
  system,
  messages,
  model = DEFAULT_MODEL,
  maxTokens = DEFAULT_MAX_TOKENS,
  temperature = DEFAULT_TEMPERATURE,
}) {
  const client = getClient()

  // Cache the system prompt — it's stable across turns in a conversation.
  // cache_control on the last system block tells Anthropic to cache up to here.
  const systemBlocks = typeof system === 'string'
    ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
    : system

  const stream = await client.messages.stream({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemBlocks,
    messages,
  })

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      const text = event.delta.text
      if (text) yield text
    }
  }
}

// Non-streaming helper for short, deterministic tasks (e.g. the future summary
// updater). Returns the full text response.
async function claudeChat({
  system,
  messages,
  model = DEFAULT_MODEL,
  maxTokens = DEFAULT_MAX_TOKENS,
  temperature = DEFAULT_TEMPERATURE,
}) {
  const client = getClient()
  const systemBlocks = typeof system === 'string'
    ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
    : system

  const resp = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemBlocks,
    messages,
  })
  const textBlocks = (resp.content || []).filter(b => b.type === 'text')
  return textBlocks.map(b => b.text).join('')
}

module.exports = { claudeChat, claudeChatStream }
