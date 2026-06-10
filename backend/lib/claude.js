// claude — thin wrapper around the Anthropic SDK for the PII-gateway LC route.
//
// Design notes:
//   - All inputs to this module MUST already be pseudonymized. We don't
//     redact here; that's the gateway's job before calling us.
//   - We use prompt caching on the system prompt — the LC system prompt is
//     long-ish and identical across turns, so caching saves ~80% of input cost.
//   - Streaming is exposed as an async generator yielding text deltas, matching
//     the shape `routes/elsie.js` already expects from `ollamaChatStream`.
//   - Configuration (base URL, API key, model ids, sampling) comes from
//     `llmConfig` which reads from app_config in DB with env-var fallback. The
//     admin LLM-provider UI writes to that table; this module picks up changes
//     within one cache TTL (or immediately when the admin save invalidates).

const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk')
const { getLlmConfig } = require('./llmConfig')

// Cache the Anthropic client by (baseURL, apiKey) so we rebuild only when
// either changes. Constructing a client is cheap, but the SDK keeps a tiny
// keep-alive pool we'd rather not churn on every turn.
let _clientCache = { baseURL: null, apiKey: null, client: null }
function getClient(cfg) {
  if (!cfg.apiKey) {
    throw new Error(
      'No LLM API key configured. Set ANTHROPIC_API_KEY in .env, or save one in the Admin → LLM Provider page.'
    )
  }
  if (_clientCache.client && _clientCache.apiKey === cfg.apiKey && _clientCache.baseURL === (cfg.baseUrl || '')) {
    return _clientCache.client
  }
  const opts = { apiKey: cfg.apiKey }
  if (cfg.baseUrl) opts.baseURL = cfg.baseUrl
  _clientCache = { baseURL: cfg.baseUrl || '', apiKey: cfg.apiKey, client: new Anthropic(opts) }
  return _clientCache.client
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
  model,        // override; defaults to cfg.chatModel
  maxTokens,    // override; defaults to cfg.maxTokens
  temperature,  // override; defaults to cfg.temperature
}) {
  const cfg = await getLlmConfig()
  const client = getClient(cfg)

  // Cache the system prompt — it's stable across turns in a conversation.
  // cache_control on the last system block tells Anthropic to cache up to here.
  const systemBlocks = typeof system === 'string'
    ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
    : system

  const stream = await client.messages.stream({
    model:        model       || cfg.chatModel,
    max_tokens:   maxTokens   ?? cfg.maxTokens,
    temperature:  temperature ?? cfg.temperature,
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

// Non-streaming helper for short, deterministic tasks (e.g. the summary
// updater). Returns the full text response.
async function claudeChat({
  system,
  messages,
  model,
  maxTokens,
  temperature,
}) {
  const cfg = await getLlmConfig()
  const client = getClient(cfg)
  const systemBlocks = typeof system === 'string'
    ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
    : system

  const resp = await client.messages.create({
    model:        model       || cfg.chatModel,
    max_tokens:   maxTokens   ?? cfg.maxTokens,
    temperature:  temperature ?? cfg.temperature,
    system: systemBlocks,
    messages,
  })
  const textBlocks = (resp.content || []).filter(b => b.type === 'text')
  return textBlocks.map(b => b.text).join('')
}

// Resolve the summary model id from runtime config. Used by the summary
// updater to route to a cheaper model than the chat path.
async function getSummaryModel() {
  const cfg = await getLlmConfig()
  return cfg.summaryModel || cfg.chatModel
}

module.exports = { claudeChat, claudeChatStream, getSummaryModel }
