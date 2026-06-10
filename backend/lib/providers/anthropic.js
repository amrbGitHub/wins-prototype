// Anthropic adapter — also handles any Anthropic-compatible endpoint
// (DeepSeek's /anthropic path, Cloudflare's gateway, AWS Bedrock's
// Anthropic API). Tool-use protocol is the native one our canonical
// format is modeled after, so this adapter is essentially pass-through.

const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk')

// Cache client per (baseUrl, apiKey) — building one is cheap but the SDK
// keeps a small keep-alive pool we'd rather not churn on every turn.
let _cache = { baseUrl: null, apiKey: null, client: null }
function getClient(cfg) {
  if (_cache.client && _cache.apiKey === cfg.apiKey && _cache.baseUrl === (cfg.baseUrl || '')) {
    return _cache.client
  }
  const opts = { apiKey: cfg.apiKey }
  if (cfg.baseUrl) opts.baseURL = cfg.baseUrl
  _cache = { baseUrl: cfg.baseUrl || '', apiKey: cfg.apiKey, client: new Anthropic(opts) }
  return _cache.client
}

function normalizeSystem(system) {
  if (typeof system === 'string') {
    return [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
  }
  return system
}

async function* chatStream({ system, messages, tools, model, maxTokens, temperature }, cfg) {
  const client = getClient(cfg)
  const stream = await client.messages.stream({
    model:       model       || cfg.chatModel,
    max_tokens:  maxTokens   ?? cfg.maxTokens,
    temperature: temperature ?? cfg.temperature,
    system: normalizeSystem(system),
    messages,
    ...(tools ? { tools } : {}),
  })

  const collectedTools = []
  // Thinking blocks must be echoed back verbatim (with their signature) when
  // the next request continues a tool loop — otherwise the API rejects with
  // "content[].thinking in the thinking mode must be passed back". We collect
  // them here and surface them as a single event for the caller to forward.
  const collectedThinking = []
  let currentTool = null
  let currentJson = ''
  let currentThinking = null
  for await (const event of stream) {
    if (event.type === 'content_block_start') {
      if (event.content_block?.type === 'tool_use') {
        currentTool = { name: event.content_block.name, input: null }
        currentJson = ''
      } else if (event.content_block?.type === 'thinking') {
        currentThinking = { type: 'thinking', thinking: '', signature: '' }
      } else if (event.content_block?.type === 'redacted_thinking') {
        collectedThinking.push({ type: 'redacted_thinking', data: event.content_block.data })
      }
    } else if (event.type === 'content_block_delta') {
      if (event.delta?.type === 'text_delta') {
        const t = event.delta.text
        if (t) yield { type: 'text', text: t }
      } else if (event.delta?.type === 'input_json_delta' && currentTool) {
        currentJson += event.delta.partial_json || ''
      } else if (event.delta?.type === 'thinking_delta' && currentThinking) {
        currentThinking.thinking += event.delta.thinking || ''
      } else if (event.delta?.type === 'signature_delta' && currentThinking) {
        currentThinking.signature += event.delta.signature || ''
      }
    } else if (event.type === 'content_block_stop') {
      if (currentTool) {
        try { currentTool.input = JSON.parse(currentJson || '{}') } catch { currentTool.input = {} }
        collectedTools.push(currentTool)
        currentTool = null
        currentJson = ''
      } else if (currentThinking) {
        collectedThinking.push(currentThinking)
        currentThinking = null
      }
    }
  }
  if (collectedThinking.length) yield { type: 'thinking', blocks: collectedThinking }
  if (collectedTools.length) yield { type: 'tools', tools: collectedTools }
}

async function chat({ system, messages, model, maxTokens, temperature }, cfg) {
  const client = getClient(cfg)
  const resp = await client.messages.create({
    model:       model       || cfg.chatModel,
    max_tokens:  maxTokens   ?? cfg.maxTokens,
    temperature: temperature ?? cfg.temperature,
    system: normalizeSystem(system),
    messages,
  })
  const textBlocks = (resp.content || []).filter(b => b.type === 'text')
  return textBlocks.map(b => b.text).join('')
}

module.exports = { chatStream, chat }
