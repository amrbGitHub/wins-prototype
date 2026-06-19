// analyzer — non-LC AI calls (journal/celebrate/goal-steps/auto-title/
// reflections review). Routes through the same multi-provider façade the LC
// gateway uses, so the admin's LLM Provider config controls every AI call in
// the app. Replaced the old Ollama path so the app no longer depends on a
// local model tunneled through ngrok.
//
// Shape mirrors what the call sites used to expect from lib/ollama.js so the
// migration is a near drop-in: pass `system` + `user` strings, get back a
// completion object whose `.choices[0].message.content` is the model text.
// `parseJSON` / `parseChatResponse` are tolerant of markdown fences and prose
// because no provider's JSON mode is exposed through the canonical interface.

const { claudeChat, claudeChatStream, getSummaryModel } = require('./claude')

// Pass either `user` (single-turn convenience) or `messages` (multi-turn
// conversation). System prompt is always separate so providers can cache it
// independently of the rolling chat history.
function buildMessages({ user, messages }) {
  if (Array.isArray(messages) && messages.length) return messages
  if (typeof user === 'string') return [{ role: 'user', content: user }]
  throw new Error('analyzer: provide either { user } or { messages }')
}
function buildSystem(system, json) {
  return json
    ? `${system}\n\nReturn ONLY valid JSON. No markdown fences, no prose before or after.`
    : system
}

// ── Single-turn analyzer chat ─────────────────────────────────────────────────
// Inputs are pseudonymized at the route boundary in lib/redactor.js if they
// contain PII; analyzers that work on trainer-authored prose (wins, drafts)
// don't go through that pipeline because the trainer is allowed to see their
// own learners' names — the pseudonymization story is about what crosses the
// wire to a third party, not what crosses the function boundary.
// Analyzer tasks are bounded JSON / short-form prose — route them to the
// configured "fast" model (cfg.summaryModel) so the expensive chat model is
// reserved for the LC gateway. Falls back to the chat model if no fast slot
// is configured.
async function analyzerChat({ system, user, messages, temperature = 0.4, maxTokens = 1024, json = false, usageContext }) {
  const fastModel = await getSummaryModel()
  return claudeChat({
    system:   buildSystem(system, json),
    messages: buildMessages({ user, messages }),
    temperature,
    maxTokens,
    usageContext,
    ...(fastModel ? { model: fastModel } : {}),
  })
}

// ── Streaming analyzer chat — async generator yielding delta strings ─────────
async function* analyzerChatStream({ system, user, messages, temperature = 0.4, maxTokens = 1024, json = false, usageContext }) {
  const fastModel = await getSummaryModel()
  for await (const event of claudeChatStream({
    system:   buildSystem(system, json),
    messages: buildMessages({ user, messages }),
    temperature,
    maxTokens,
    usageContext,
    ...(fastModel ? { model: fastModel } : {}),
  })) {
    if (event.type === 'text' && event.text) yield event.text
  }
}

// ── JSON parsing helpers (tolerant of markdown / surrounding prose) ──────────
function parseJSON(content) {
  const cleaned = (content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
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

// Parse a chat-turn response: try JSON, gracefully fall back to plain text
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

module.exports = { analyzerChat, analyzerChatStream, parseJSON, sanitiseMessage, parseChatResponse }
