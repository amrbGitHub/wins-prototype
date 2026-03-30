const { Router } = require('express')
const { supabase } = require('../config')
const { verifyToken } = require('../middleware/auth')
const { ollamaChat, getContent, parseChatResponse } = require('../lib/ollama')
const { toMonthLabel } = require('../lib/shapes')

const router = Router()

// ── POST /api/reflections/chat — stateless weekly review Q&A turn ─────────────
// No auth required — stateless, like /api/planner/chat
router.post('/chat', async (req, res) => {
  try {
    const { messages = [], goals = [], month } = req.body || {}
    const monthLabel    = toMonthLabel(month)
    const minExchanges  = Math.max(goals.length * 2, 4)

    const goalsList = goals.map((g, i) =>
      `${i + 1}. "${g.title}"${g.description ? ` — ${g.description}` : ''}${g.successCriteria ? ` (Success: ${g.successCriteria})` : ''}`
    ).join('\n')

    const system = `
You are conducting a friendly weekly progress review for a workplace trainer's goals for ${monthLabel}.

Their goals are:
${goalsList}

Ask ONE focused question at a time. Cover each goal at least once:
- Have they started working toward it?
- What specific progress have they made?
- What obstacles or challenges have come up?
- How confident do they feel about completing it?

Guidelines:
- Be warm, specific, and encouraging — reference goals by name
- For the opening turn (no prior messages): greet them warmly, say this is their weekly check-in, and ask your first question
- After at least ${minExchanges} exchanges covering ALL ${goals.length} goal(s), write the final evaluation

When you have gathered enough information, respond with "done": true and include:
- "evaluation": 2–4 paragraphs — an honest, encouraging written assessment of their overall progress
- "suggestions": 3–5 short actionable ideas to help them make better progress (each a single sentence)

Until you have enough info:
{"message":"your question or comment","done":false,"evaluation":"","suggestions":[]}

When done:
{"message":"brief warm closing remark","done":true,"evaluation":"full written evaluation...","suggestions":["suggestion 1","suggestion 2",...]}

Always respond with valid JSON only — no text outside the JSON.
`.trim()

    const chatMessages = messages.length === 0
      ? [{ role: 'user', content: 'Please start the weekly progress review.' }]
      : messages

    const completion = await ollamaChat({
      messages: [{ role: 'system', content: system }, ...chatMessages],
      temperature: 0.6,
      json: true,
    })

    const parsed = parseChatResponse(getContent(completion), {
      done: false, evaluation: '', suggestions: [],
    })

    res.json({
      message:     parsed.message,
      done:        !!parsed.done,
      evaluation:  parsed.evaluation  || '',
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/reflections — list all reflections for user, newest first ─────────
router.get('/', verifyToken, async (req, res) => {
  try {
    let query = supabase
      .from('reflections')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
    if (req.query.month) query = query.eq('month', req.query.month)
    const { data, error } = await query
    if (error) throw error
    res.json(data.map(r => ({
      id:            r.id,
      month:         r.month,
      createdAt:     r.created_at,
      goalsSnapshot: r.goals_snapshot,
      evaluation:    r.evaluation,
      suggestions:   r.suggestions,
    })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/reflections — save a completed reflection ───────────────────────
router.post('/', verifyToken, async (req, res) => {
  try {
    const { month, goalsSnapshot, conversation, evaluation, suggestions } = req.body || {}
    const { data, error } = await supabase
      .from('reflections')
      .insert({
        user_id:        req.userId,
        month,
        goals_snapshot: goalsSnapshot,
        conversation,
        evaluation,
        suggestions,
      })
      .select()
      .single()
    if (error) throw error
    res.json({
      id:            data.id,
      month:         data.month,
      createdAt:     data.created_at,
      goalsSnapshot: data.goals_snapshot,
      evaluation:    data.evaluation,
      suggestions:   data.suggestions,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
