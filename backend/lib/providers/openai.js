// OpenAI adapter — also covers any OpenAI-compatible endpoint (Mistral
// via api.mistral.ai, Together AI, Groq, Fireworks, vLLM-served models,
// LM Studio, etc) by setting a custom baseUrl.
//
// Translates the canonical Anthropic-shaped message history into OpenAI's
// chat-completions format. Key shape differences vs Anthropic:
//
//   - System prompt is the first message with role 'system' (no caching).
//   - Tool definitions wrap in { type: 'function', function: {...} }.
//   - Tool calls live in assistant.tool_calls; results in role:'tool' messages.
//   - One tool_result becomes one tool-role message; cannot merge into user.

const OpenAI = require('openai').default || require('openai')

let _cache = { baseUrl: null, apiKey: null, client: null }
function getClient(cfg) {
  if (_cache.client && _cache.apiKey === cfg.apiKey && _cache.baseUrl === (cfg.baseUrl || '')) {
    return _cache.client
  }
  const opts = { apiKey: cfg.apiKey }
  if (cfg.baseUrl) opts.baseURL = cfg.baseUrl
  _cache = { baseUrl: cfg.baseUrl || '', apiKey: cfg.apiKey, client: new OpenAI(opts) }
  return _cache.client
}

function systemToText(system) {
  if (!system) return ''
  if (typeof system === 'string') return system
  return system.map(b => b?.text || '').filter(Boolean).join('\n\n')
}

function toolsToOpenAI(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema || { type: 'object', properties: {} },
    },
  }))
}

// Canonical → OpenAI messages. Handles three things per turn:
//   - assistant text → assistant.content
//   - assistant tool_use → assistant.tool_calls
//   - user tool_result → role:'tool' message (must immediately follow the
//     assistant that called it; we keep order from the canonical array)
//   - user text → role:'user'
function messagesToOpenAI(messages, system) {
  const out = []
  const sys = systemToText(system)
  if (sys) out.push({ role: 'system', content: sys })

  for (const m of messages) {
    const blocks = Array.isArray(m.content)
      ? m.content
      : [{ type: 'text', text: String(m.content || '') }]

    if (m.role === 'assistant') {
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('')
      const toolUses = blocks.filter(b => b.type === 'tool_use')
      const msg = { role: 'assistant', content: text || null }
      if (toolUses.length) {
        msg.tool_calls = toolUses.map(t => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: JSON.stringify(t.input || {}) },
        }))
      }
      out.push(msg)
      continue
    }

    // user role: tool_result blocks become separate tool-role messages first,
    // then any trailing text becomes one user message.
    const toolResults = blocks.filter(b => b.type === 'tool_result')
    for (const tr of toolResults) {
      out.push({
        role: 'tool',
        tool_call_id: tr.tool_use_id,
        content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
      })
    }
    const userText = blocks.filter(b => b.type === 'text').map(b => b.text).join('')
    if (userText) out.push({ role: 'user', content: userText })
  }
  return out
}

async function* chatStream({ system, messages, tools, model, maxTokens, temperature }, cfg) {
  const client = getClient(cfg)
  const stream = await client.chat.completions.create({
    model:       model       || cfg.chatModel,
    max_tokens:  maxTokens   ?? cfg.maxTokens,
    temperature: temperature ?? cfg.temperature,
    messages: messagesToOpenAI(messages, system),
    tools: toolsToOpenAI(tools),
    stream: true,
  })

  // Tool calls stream as a parallel array per chunk; we accumulate by index.
  const toolAcc = new Map()      // index → { id, name, argsJson }
  for await (const chunk of stream) {
    const choice = chunk.choices?.[0]
    if (!choice) continue
    const delta = choice.delta || {}
    if (delta.content) yield { type: 'text', text: delta.content }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0
        const cur = toolAcc.get(idx) || { id: null, name: null, argsJson: '' }
        if (tc.id) cur.id = tc.id
        if (tc.function?.name) cur.name = tc.function.name
        if (tc.function?.arguments) cur.argsJson += tc.function.arguments
        toolAcc.set(idx, cur)
      }
    }
  }
  if (toolAcc.size) {
    const tools = []
    for (const [, t] of toolAcc) {
      if (!t.name) continue
      let input = {}
      try { input = JSON.parse(t.argsJson || '{}') } catch { input = {} }
      tools.push({ name: t.name, input })
    }
    if (tools.length) yield { type: 'tools', tools }
  }
}

async function chat({ system, messages, model, maxTokens, temperature }, cfg) {
  const client = getClient(cfg)
  const resp = await client.chat.completions.create({
    model:       model       || cfg.chatModel,
    max_tokens:  maxTokens   ?? cfg.maxTokens,
    temperature: temperature ?? cfg.temperature,
    messages: messagesToOpenAI(messages, system),
  })
  return {
    text: resp.choices?.[0]?.message?.content || '',
    usage: {
      inputTokens:  resp.usage?.prompt_tokens     || 0,
      outputTokens: resp.usage?.completion_tokens || 0,
      model:        resp.model || (model || cfg.chatModel),
    },
  }
}

module.exports = { chatStream, chat, _internal: { messagesToOpenAI, toolsToOpenAI } }
