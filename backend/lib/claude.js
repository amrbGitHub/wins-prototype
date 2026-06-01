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
  // ANTHROPIC_BASE_URL lets us point the SDK at any Anthropic-compatible
  // endpoint (e.g. DeepSeek's https://api.deepseek.com/anthropic). Unset →
  // SDK uses Anthropic's default URL. Combined with ANTHROPIC_MODEL, this is
  // how we swap providers without touching code.
  const opts = { apiKey }
  const baseURL = process.env.ANTHROPIC_BASE_URL
  if (baseURL) opts.baseURL = baseURL
  _client = new Anthropic(opts)
  return _client
}

// Async generator yielding typed events as the model streams:
//   { type: 'text', text: '<delta>' }   — prose chunks
//   { type: 'tools', tools: [ {name, input} ] } — emitted once at end if the
//                                                  model called any tools
//
// Caller is responsible for ensuring `messages` and `tools` contain only
// pseudonymized content — we don't redact here.
async function* claudeChatStream({
  system,
  messages,
  tools = undefined,
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
    ...(tools ? { tools } : {}),
  })

  // Tool-use blocks arrive as content_block_start (with name) followed by
  // a stream of input_json_delta partials, then content_block_stop. We
  // accumulate the partials and parse once the block ends.
  const collectedTools = []
  let currentTool = null
  let currentJson = ''

  for await (const event of stream) {
    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      currentTool = { name: event.content_block.name, input: null }
      currentJson = ''
    } else if (event.type === 'content_block_delta') {
      if (event.delta?.type === 'text_delta') {
        const text = event.delta.text
        if (text) yield { type: 'text', text }
      } else if (event.delta?.type === 'input_json_delta' && currentTool) {
        currentJson += event.delta.partial_json || ''
      }
    } else if (event.type === 'content_block_stop' && currentTool) {
      try { currentTool.input = JSON.parse(currentJson || '{}') } catch { currentTool.input = {} }
      collectedTools.push(currentTool)
      currentTool = null
      currentJson = ''
    }
  }

  if (collectedTools.length) yield { type: 'tools', tools: collectedTools }
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
