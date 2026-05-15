const { Router } = require('express')
const { supabase } = require('../config')
const { verifyToken } = require('../middleware/auth')

const router = Router()

// ── Validation helpers ────────────────────────────────────────────────────────
const MAX_MSG_BYTES   = 32_000     // ~32KB per message
const MAX_TITLE_BYTES = 200

function isValidMessage(m) {
  if (!m || typeof m !== 'object') return false
  if (!['user', 'assistant'].includes(m.role)) return false
  if (typeof m.content !== 'string') return false
  if (m.content.length > MAX_MSG_BYTES) return false
  return true
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
    res.status(500).json({ error: err.message })
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
    res.status(500).json({ error: err.message })
  }
})

// POST /api/lc/conversations — create new conversation
router.post('/', verifyToken, async (req, res) => {
  try {
    const { title, plannerMode, messages } = req.body || {}
    const initialMessages = Array.isArray(messages) ? messages : []
    if (!initialMessages.every(isValidMessage)) {
      return res.status(400).json({ error: 'Invalid message shape' })
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
    res.status(500).json({ error: err.message })
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
    if (!incoming.every(isValidMessage)) return res.status(400).json({ error: 'Invalid message shape' })

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
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/lc/conversations/:id — update title / plannerMode / messages (full replace)
router.patch('/:id', verifyToken, async (req, res) => {
  try {
    const { title, plannerMode, messages } = req.body || {}
    const patch = {}
    if (title       !== undefined) patch.title        = title?.trim()?.slice(0, MAX_TITLE_BYTES) || null
    if (plannerMode !== undefined) patch.planner_mode = !!plannerMode
    if (messages !== undefined) {
      if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages must be array' })
      if (!messages.every(isValidMessage)) return res.status(400).json({ error: 'Invalid message shape' })
      patch.messages = messages
    }

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
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/lc/conversations/:id
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { error } = await supabase
      .from('lc_conversations')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
    if (error) throw error
    res.status(204).send()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
