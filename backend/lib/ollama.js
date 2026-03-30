const { OLLAMA_BASE_URL, OLLAMA_MODEL } = require('../config')

// ── Core chat call ────────────────────────────────────────────────────────────
async function ollamaChat({ messages, temperature = 0.4, json = false }) {
  const body = { model: OLLAMA_MODEL, messages, temperature, stream: false }
  if (json) body.format = 'json'

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
    const cause = err.cause?.message ?? err.cause ?? ''
    throw new Error(
      `Ollama unreachable at ${OLLAMA_BASE_URL}: ${err.message}${cause ? ` (${cause})` : ''}`
    )
  }

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Ollama error ${resp.status} at ${OLLAMA_BASE_URL}/chat/completions: ${text}`)
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

module.exports = { ollamaChat, getContent, parseJSON, sanitiseMessage, parseChatResponse }
