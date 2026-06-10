const { OLLAMA_BASE_URL, OLLAMA_MODEL } = require('../config')

// ── Core chat call ────────────────────────────────────────────────────────────
// `json`        - true → force valid JSON output (any shape)
// `jsonSchema`  - object → force output to match this JSON schema (Ollama structured-output mode)
async function ollamaChat({ messages, temperature = 0.4, json = false, jsonSchema = null }) {
  const body = { model: OLLAMA_MODEL, messages, temperature, stream: false }
  if (jsonSchema)   body.response_format = { type: 'json_schema', json_schema: { name: 'lc_response', schema: jsonSchema, strict: true } }
  else if (json)    body.format = 'json'

  let resp
  try {
    resp = await fetch(`${OLLAMA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    // Cybersec audit Finding #1: never echo OLLAMA_BASE_URL (the ngrok tunnel)
    // back to callers. Log the detail server-side; throw a generic message
    // that the global error handler can safely surface to clients.
    console.error('[ollama] unreachable:', OLLAMA_BASE_URL, err?.message, err?.cause?.message || err?.cause || '')
    const e = new Error('AI service temporarily unavailable.')
    e.status = 503
    e.publicMessage = 'AI service temporarily unavailable.'
    throw e
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    console.error('[ollama] non-2xx:', resp.status, text.slice(0, 500))
    const e = new Error(`AI service returned ${resp.status}.`)
    e.status = 502
    e.publicMessage = 'AI service is having trouble right now. Please try again shortly.'
    throw e
  }

  return resp.json()
}

// ── Response helpers ──────────────────────────────────────────────────────────

// Extract the raw content string from an Ollama completion
function getContent(completion) {
  return completion?.choices?.[0]?.message?.content ?? ''
}

// Parse JSON from model output — handles markdown fences and prose before/after the JSON block
function parseJSON(content) {
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  try { return JSON.parse(cleaned) } catch {}
  const start = cleaned.indexOf('{')
  const end   = cleaned.lastIndexOf('}')
  if (start !== -1 && end > start) return JSON.parse(cleaned.slice(start, end + 1))
  throw new SyntaxError('No JSON object found in model output')
}

// Strip any trailing JSON blob that leaked into a plain-text message field
function sanitiseMessage(msg) {
  return (msg || '').replace(/\{[\s\S]*\}\s*$/, '').trim()
}

// Parse a chat-turn response: try JSON, gracefully fall back to plain text.
// `defaults` is merged into the fallback object so callers get the right shape.
function parseChatResponse(content, defaults = {}) {
  try {
    const parsed = parseJSON(content)
    return { ...defaults, ...parsed, message: sanitiseMessage(parsed.message) }
  } catch {
    return {
      ...defaults,
      message: sanitiseMessage(content?.trim()) || 'Sorry, I had trouble responding. Please try again.',
    }
  }
}

// ── Streaming chat call — async generator that yields delta strings ───────────
async function* ollamaChatStream({ messages, temperature = 0.4, json = false, jsonSchema = null, maxTokens = 1024 }) {
  // maxTokens defaults to 1024 — enough for a 2-3 sentence reply + an action JSON,
  // but high enough that a chatty exchange won't be silently cut off mid-sentence.
  const body = { model: OLLAMA_MODEL, messages, temperature, stream: true, max_tokens: maxTokens }
  if (jsonSchema)   body.response_format = { type: 'json_schema', json_schema: { name: 'lc_response', schema: jsonSchema, strict: true } }
  else if (json)    body.format = 'json'

  let resp
  try {
    resp = await fetch(`${OLLAMA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error('[ollama-stream] unreachable:', OLLAMA_BASE_URL, err?.message, err?.cause?.message || err?.cause || '')
    const e = new Error('AI service temporarily unavailable.')
    e.status = 503
    e.publicMessage = 'AI service temporarily unavailable.'
    throw e
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    console.error('[ollama-stream] non-2xx:', resp.status, text.slice(0, 500))
    const e = new Error(`AI service returned ${resp.status}.`)
    e.status = 502
    e.publicMessage = 'AI service is having trouble right now. Please try again shortly.'
    throw e
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const flushLine = function* (line) {
    if (!line.startsWith('data: ')) return
    const data = line.slice(6).trim()
    if (data === '[DONE]') return
    try {
      const chunk = JSON.parse(data)
      const delta = chunk.choices?.[0]?.delta?.content
      if (delta) yield delta
    } catch {}
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) yield* flushLine(line)
  }
  // Flush any trailing line that wasn't terminated by \n before the stream closed.
  // Without this we silently drop the final chunk of content, which manifests as
  // truncated messages (e.g. "Here are a few ideas:" with no follow-through).
  if (buffer.trim()) yield* flushLine(buffer)
}

module.exports = { ollamaChat, ollamaChatStream, getContent, parseJSON, sanitiseMessage, parseChatResponse }
