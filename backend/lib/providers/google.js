// Google Gemini adapter.
//
// Translates the canonical Anthropic-shaped message history into Gemini's
// generateContent format. Notable differences:
//
//   - Assistant role is 'model'.
//   - Content lives in `parts` arrays of typed parts: {text}, {functionCall},
//     {functionResponse}.
//   - System prompt is a separate `systemInstruction` field (not a message).
//   - Tools are wrapped as { functionDeclarations: [...] } and parameters
//     use JSON Schema (compatible with Anthropic's input_schema).
//   - No prompt caching primitive — system is sent fresh each turn.

const { GoogleGenerativeAI } = require('@google/generative-ai')

let _cache = { apiKey: null, client: null }
function getClient(cfg) {
  if (_cache.client && _cache.apiKey === cfg.apiKey) return _cache.client
  _cache = { apiKey: cfg.apiKey, client: new GoogleGenerativeAI(cfg.apiKey) }
  return _cache.client
}

function systemToText(system) {
  if (!system) return ''
  if (typeof system === 'string') return system
  return system.map(b => b?.text || '').filter(Boolean).join('\n\n')
}

function toolsToGemini(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined
  return [{
    functionDeclarations: tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema || { type: 'object', properties: {} },
    })),
  }]
}

// Canonical → Gemini contents. Per turn:
//   - assistant text + tool_use → role:'model' with parts [{text}, {functionCall}]
//   - user tool_result → role:'user' with parts [{functionResponse}]
//     (Gemini doesn't have a tool role; results go in a user-role turn.)
//   - user text → role:'user' with parts [{text}]
//
// Gemini's functionResponse requires the original function NAME (not the id
// our canonical format uses to pair calls with results). We pre-walk the
// canonical history to build a tool_use_id → name map, then look up the
// name when emitting each functionResponse.
function messagesToGemini(messages) {
  const idToName = new Map()
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    const blocks = Array.isArray(m.content) ? m.content : []
    for (const b of blocks) {
      if (b.type === 'tool_use' && b.id && b.name) idToName.set(b.id, b.name)
    }
  }

  const out = []
  for (const m of messages) {
    const blocks = Array.isArray(m.content)
      ? m.content
      : [{ type: 'text', text: String(m.content || '') }]
    const parts = []
    for (const b of blocks) {
      if (b.type === 'text' && b.text) {
        parts.push({ text: b.text })
      } else if (b.type === 'tool_use') {
        parts.push({ functionCall: { name: b.name, args: b.input || {} } })
      } else if (b.type === 'tool_result') {
        const fnName = idToName.get(b.tool_use_id) || 'tool'
        parts.push({
          functionResponse: {
            name: fnName,
            response: { content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) },
          },
        })
      }
    }
    if (parts.length) {
      out.push({ role: m.role === 'assistant' ? 'model' : 'user', parts })
    }
  }
  return out
}

async function* chatStream({ system, messages, tools, model: modelOverride, maxTokens, temperature }, cfg) {
  const client = getClient(cfg)
  const modelName = modelOverride || cfg.chatModel
  const sys = systemToText(system)
  const model = client.getGenerativeModel({
    model: modelName,
    systemInstruction: sys || undefined,
    tools: toolsToGemini(tools),
    generationConfig: {
      maxOutputTokens: maxTokens ?? cfg.maxTokens,
      temperature:     temperature ?? cfg.temperature,
    },
  })
  const contents = messagesToGemini(messages)

  const result = await model.generateContentStream({ contents })
  const collectedCalls = []
  for await (const chunk of result.stream) {
    // chunk.text() concatenates text parts but skips function calls.
    let text = ''
    try { text = chunk.text() } catch { text = '' }
    if (text) yield { type: 'text', text }
    const cands = chunk.candidates || []
    for (const c of cands) {
      const parts = c.content?.parts || []
      for (const p of parts) {
        if (p.functionCall) collectedCalls.push({ name: p.functionCall.name, input: p.functionCall.args || {} })
      }
    }
  }
  if (collectedCalls.length) yield { type: 'tools', tools: collectedCalls }
}

async function chat({ system, messages, model: modelOverride, maxTokens, temperature }, cfg) {
  const client = getClient(cfg)
  const modelName = modelOverride || cfg.chatModel
  const sys = systemToText(system)
  const model = client.getGenerativeModel({
    model: modelName,
    systemInstruction: sys || undefined,
    generationConfig: {
      maxOutputTokens: maxTokens ?? cfg.maxTokens,
      temperature:     temperature ?? cfg.temperature,
    },
  })
  const contents = messagesToGemini(messages)
  const resp = await model.generateContent({ contents })
  return resp.response?.text?.() || ''
}

module.exports = { chatStream, chat, _internal: { messagesToGemini, toolsToGemini } }
