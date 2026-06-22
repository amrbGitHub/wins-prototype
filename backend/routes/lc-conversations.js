const { Router } = require('express')
const { supabase } = require('../config')
const { verifyToken } = require('../middleware/auth')
const { analyzerChat } = require('../lib/analyzer')

const router = Router()

// ── Validation helpers ────────────────────────────────────────────────────────
const MAX_MSG_BYTES   = 32_000     // ~32KB per message
const MAX_TITLE_BYTES = 200

// Default policy: only role='user' messages may be written by client requests.
// role='assistant' rows are owned by the LLM gateway (routes/elsie.js) — the
// integrity story for admin chat review depends on the assistant column being
// trustworthy. The 2026-06-17 fuzzer exploited the prior any-role policy to
// stuff fake LC replies into conversations. Pass { allowAssistant: true } in
// internal contexts where a server route is explicitly seeding history.
function isValidMessage(m, { allowAssistant = false } = {}) {
  if (!m || typeof m !== 'object') return false
  if (m.role === 'user') {
    // fall through
  } else if (m.role === 'assistant' && allowAssistant) {
    // fall through
  } else {
    return false
  }
  if (typeof m.content !== 'string') return false
  if (m.content.length > MAX_MSG_BYTES) return false
  return true
}

// Canned greetings used by /greeting. Kept on the server so that, like
// assistant turns from the LLM, the message recorded in the conversation is
// always one the server actually produced.
const GREETING_TEMPLATES = [
  '! What can I do for you today?',
  '! I am here whenever you want to update a goal, log a win, or talk something through.',
  '! What would you like help with right now?',
  '! Tell me what is going on, and I will help however I can.',
  '! Want to update progress, capture a win, or just check in?',
]
function buildGreeting(firstName) {
  const name = (firstName || '').trim()
  const hey  = name ? `Hey ${name}` : 'Hey'
  const tail = GREETING_TEMPLATES[Math.floor(Math.random() * GREETING_TEMPLATES.length)]
  return hey + tail
}

// ── Row mapper ────────────────────────────────────────────────────────────────
function dbRowToConversation(row, { includeMessages = true, messageCount = null } = {}) {
  const base = {
    id:           row.id,
    title:        row.title || 'New chat',
    plannerMode:  !!row.planner_mode,
    createdAt:    new Date(row.created_at).getTime(),
    updatedAt:    new Date(row.updated_at).getTime(),
  }
  if (includeMessages) {
    base.messages = Array.isArray(row.messages) ? row.messages : []
  } else {
    base.messageCount = messageCount ?? (Array.isArray(row.messages) ? row.messages.length : 0)
  }
  return base
}

// GET /api/lc/conversations — list all conversations (no messages, just count)
// Note: ideally `messageCount` would be a generated column or computed via
// `jsonb_array_length` in SQL — see migration 002. Until then we still SELECT
// messages but truncate immediately on the server so we don't ship the JSONB
// blob to the client (it stays in the Node process for one millisecond).
router.get('/', verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('lc_conversations')
      .select('id,title,planner_mode,messages,created_at,updated_at')
      .eq('user_id', req.userId)
      .order('updated_at', { ascending: false })
    if (error) throw error
    res.json(data.map(row => dbRowToConversation(row, { includeMessages: false })))
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// GET /api/lc/conversations/:id — full conversation with messages
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('lc_conversations')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Conversation not found' })
    res.json(dbRowToConversation(data))
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// POST /api/lc/conversations — create new conversation
router.post('/', verifyToken, async (req, res) => {
  try {
    const { title, plannerMode, messages } = req.body || {}
    const initialMessages = Array.isArray(messages) ? messages : []
    // New conversations should generally start empty; if the client seeds any
    // initial messages they must be user-role (canonical greeting comes from
    // /greeting, not from create).
    if (!initialMessages.every(m => isValidMessage(m))) {
      return res.status(400).json({ error: 'Invalid message shape (only role="user" accepted)' })
    }
    const { data, error } = await supabase
      .from('lc_conversations')
      .insert({
        user_id:      req.userId,
        title:        title?.trim()?.slice(0, MAX_TITLE_BYTES) || null,
        planner_mode: !!plannerMode,
        messages:     initialMessages,
      })
      .select()
      .single()
    if (error) throw error
    res.status(201).json(dbRowToConversation(data))
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// POST /api/lc/conversations/:id/greeting — server-owned first assistant turn.
// Picks one of GREETING_TEMPLATES, appends it to the conversation as an
// assistant message, returns the rendered text. This exists because the
// /messages endpoint forbids role='assistant'; the greeting is canned content
// (no LLM call), but it still needs to be written by the server so admins can
// trust every assistant row in lc_conversations came from us.
router.post('/:id/greeting', verifyToken, async (req, res) => {
  try {
    const { firstName = '' } = req.body || {}
    const greeting = buildGreeting(firstName)

    const { data: row, error: readErr } = await supabase
      .from('lc_conversations')
      .select('messages')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single()
    if (readErr) throw readErr
    if (!row) return res.status(404).json({ error: 'Conversation not found' })

    const existing = Array.isArray(row.messages) ? row.messages : []
    // Avoid duplicating a greeting if one was already seeded for this convo.
    if (existing.some(m => m.role === 'assistant')) {
      return res.json({ greeting: existing.find(m => m.role === 'assistant').content, alreadySeeded: true })
    }

    const assistantMsg = { role: 'assistant', content: greeting, actions: [] }
    const { error: updErr } = await supabase
      .from('lc_conversations')
      .update({ messages: [...existing, assistantMsg] })
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
    if (updErr) throw updErr

    res.json({ greeting })
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// POST /api/lc/conversations/:id/messages — append messages (avoids full JSONB rewrite)
// Read-modify-write scoped to user_id. Cheaper than the deep-watch + full PATCH
// pattern that fired on every reactive mutation in the frontend. Use this on
// turn boundaries — not on every streamed delta.
router.post('/:id/messages', verifyToken, async (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.messages) ? req.body.messages : []
    if (!incoming.length) return res.status(400).json({ error: 'messages array required' })
    if (!incoming.every(m => isValidMessage(m))) {
      return res.status(400).json({
        error: 'Invalid message shape. Only role="user" messages may be appended via this endpoint; assistant turns are written by the LLM gateway.',
      })
    }

    const { data: row, error: readErr } = await supabase
      .from('lc_conversations')
      .select('messages')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single()
    if (readErr) throw readErr
    if (!row) return res.status(404).json({ error: 'Conversation not found' })

    const merged = [...(Array.isArray(row.messages) ? row.messages : []), ...incoming]

    const { data, error } = await supabase
      .from('lc_conversations')
      .update({ messages: merged })
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select()
      .single()
    if (error) throw error
    res.json(dbRowToConversation(data))
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// PATCH /api/lc/conversations/:id — update title / plannerMode only.
// Note: `messages` is intentionally NOT patchable here. Full-array replace
// would let a caller blow away or rewrite assistant history, defeating the
// data-integrity story that role='assistant' rows come only from the LLM
// gateway. Use POST /:id/messages (user-role only) or the gateway's
// internal append.
router.patch('/:id', verifyToken, async (req, res) => {
  try {
    const { title, plannerMode } = req.body || {}
    const patch = {}
    if (title       !== undefined) patch.title        = title?.trim()?.slice(0, MAX_TITLE_BYTES) || null
    if (plannerMode !== undefined) patch.planner_mode = !!plannerMode

    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' })

    const { data, error } = await supabase
      .from('lc_conversations')
      .update(patch)
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select()
      .single()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Conversation not found' })
    res.json(dbRowToConversation(data))
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// DELETE /api/lc/conversations/:id
// Cascade also drops junction rows in lc_conversation_pseudonyms. After
// that we sweep orphan pseudonyms (registry rows no other conversation
// references) so deleting an old chat actually forgets the people in it.
// Sweep failure is non-fatal — the conversation IS deleted; the user can
// also hit the global wipe button if registry hygiene matters more.
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { error } = await supabase
      .from('lc_conversations')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
    if (error) throw error

    const { error: gcErr } = await supabase.rpc('delete_orphan_pseudonyms', { p_user_id: req.userId })
    if (gcErr) console.warn('[lc-conversations] orphan GC failed (non-fatal):', gcErr.message)

    res.status(204).send()
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// Fallback title heuristic: take the first user message, trim, cap.
// Used when Ollama is unavailable (CUDA error, unreachable, etc.) so the
// conversation still gets a meaningful title and the sidebar doesn't stay
// stuck on "New chat" forever.
function fallbackTitleFrom(msgs) {
  const firstUser = msgs.find(m => m.role === 'user')
  if (!firstUser) return null
  const raw = String(firstUser.content || '').trim()
  if (!raw) return null
  // Take up to ~6 words, single line, cap at MAX_TITLE_BYTES.
  const words = raw.replace(/\s+/g, ' ').split(' ').slice(0, 6).join(' ')
  return words.slice(0, MAX_TITLE_BYTES) || null
}

// POST /api/lc/conversations/:id/auto-title — generate a short title from
// the conversation's actual content. Frontend calls this after the first
// real exchange so the sidebar doesn't say "Hello, this is what I said…"
// truncated forever. Uses a quick non-streaming Ollama call, with a
// deterministic fallback if Ollama is unavailable.
router.post('/:id/auto-title', verifyToken, async (req, res) => {
  try {
    // Load the conversation (auth-scoped) so we use the persisted state,
    // not whatever the client sends in the body.
    const { data: row, error: readErr } = await supabase
      .from('lc_conversations')
      .select('id, title, messages')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single()
    if (readErr) throw readErr
    if (!row) return res.status(404).json({ error: 'Conversation not found' })

    const msgs = Array.isArray(row.messages) ? row.messages : []
    if (msgs.length < 2) return res.status(400).json({ error: 'Not enough conversation yet' })

    // Try LLM-summarized title first; fall back to first-user-message heuristic
    // on ANY failure (provider outage, empty response, etc.) so the chat ends
    // up with *some* meaningful title instead of staying "New chat".
    let title = null
    let usedFallback = false

    try {
      const transcript = msgs.slice(0, 8).map(m =>
        `${m.role === 'user' ? 'User' : 'LC'}: ${(m.content || '').slice(0, 400)}`
      ).join('\n')

      const text = await analyzerChat({
        system:
          'Summarize the topic of this conversation in 3 to 6 words. ' +
          'Return JUST the title — no quotes, no punctuation at the end, no "Title:" prefix, no explanation. ' +
          'Examples of good titles: "May cohort retro", "Workshop pacing problem", "Log Alex\'s feedback win", "Plan Module 3 design". ' +
          'Examples of bad titles: "A conversation about X", "User wants to...", "Discussion of goals".',
        user: transcript,
        temperature: 0.3,
        maxTokens: 64,
      })
      title = text.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/[.!?]+$/, '').trim()
      if (!title) throw new Error('empty title from model')
    } catch (llmErr) {
      // Model call failed — log and fall back deterministically
      console.warn('[auto-title] provider unavailable, using heuristic fallback:', llmErr.message)
      title = fallbackTitleFrom(msgs)
      usedFallback = true
      if (!title) return res.status(500).json({ error: 'No content to derive title from' })
    }

    if (title.length > MAX_TITLE_BYTES) title = title.slice(0, MAX_TITLE_BYTES)

    const { data, error } = await supabase
      .from('lc_conversations')
      .update({ title })
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select()
      .single()
    if (error) throw error
    const result = dbRowToConversation(data)
    if (usedFallback) result._fallback = true     // diagnostic for frontend logging
    res.json(result)
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

module.exports = router
