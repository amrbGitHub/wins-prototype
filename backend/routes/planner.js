const { Router } = require('express')
const { supabase } = require('../config')
const { verifyToken } = require('../middleware/auth')
const { ollamaChat, getContent, parseJSON, parseChatResponse, sanitiseMessage } = require('../lib/ollama')
const { dbGoalToShape, toMonthLabel, replaceGoals } = require('../lib/shapes')

const router = Router()

// ── GET /api/planner/:month — load session for a month ────────────────────────
router.get('/:month', verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('planner_sessions')
      .select('messages, ready_to_extract')
      .eq('user_id', req.userId)
      .eq('month', req.params.month)
      .single()
    if (error && error.code !== 'PGRST116') throw error
    res.json(data ? { messages: data.messages, readyToExtract: data.ready_to_extract } : null)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/planner/session — upsert session + replace goals ────────────────
// Registered before /:month so "session" is never treated as a month param.
router.post('/session', verifyToken, async (req, res) => {
  try {
    const { month, messages, goals } = req.body || {}

    // Run session upsert and goals replacement in parallel — they're independent tables
    const ops = [
      supabase
        .from('planner_sessions')
        .upsert({ user_id: req.userId, month, messages }, { onConflict: 'user_id,month' }),
    ]
    if (Array.isArray(goals) && goals.length) {
      ops.push(replaceGoals(req.userId, month, goals))
    }

    const results = await Promise.all(ops)
    const sessResult = results[0]
    if (sessResult.error) throw sessResult.error

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── DELETE /api/planner/:month — delete session + all goals for a month ───────
router.delete('/:month', verifyToken, async (req, res) => {
  try {
    await Promise.all([
      supabase.from('planner_sessions').delete().eq('user_id', req.userId).eq('month', req.params.month),
      supabase.from('goals').delete().eq('user_id', req.userId).eq('month', req.params.month),
    ])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/planner/chat — stateless AI planning turn ───────────────────────
router.post('/chat', async (req, res) => {
  try {
    const { messages = [], month, mode = 'text' } = req.body || {}
    const monthLabel = toMonthLabel(month)
    const isConvo    = mode === 'convo'

    const system = `
You are a warm, thoughtful planning coach for a workplace trainer (L&D professional).
Help them clarify their professional goals for ${monthLabel} through natural conversation.

Ask ONE focused question at a time. Progress through these themes:
1. Their main professional priority or focus for the month
2. Specific, concrete outcomes they want to achieve
3. Challenges or obstacles they anticipate
4. How they'll know they've succeeded (success criteria)
5. Key habits, resources, or support they need

Guidelines:
- Be warm and encouraging — like a trusted coach, not a form
- Acknowledge what they share before moving on
- Ask follow-up questions if an answer is vague
- For the opening turn (no prior messages): greet them warmly by name of the month and ask your first question${isConvo ? `

CONVO MODE (voice conversation):
- Keep each response to 2-3 sentences maximum — short enough to speak aloud naturally
- No bullet points, numbered lists, or markdown — plain spoken sentences only
- When you have enough detail to form clear goals (usually after 3-5 exchanges), announce them out loud:
  e.g. "I've set two goals for you this month. First: [goal title] — [one sentence description]. Second: [goal title] — [one sentence description]. Does that sound right?"
- After announcing goals, ask if any adjustments are needed` : `

TEXT MODE:
- When you have enough detail to form clear goals, ask: "Are you ready to distill this into some clear goals for the month?"
- After the user confirms, write a clear summary with a short paragraph recap followed by a numbered list of 2–4 specific actionable goals
- End by asking if any adjustments are needed`}

GOAL TRACKING — this is critical:
After every response, maintain a "goals" array representing your BEST CURRENT understanding of the user's goals.
- Start with an empty array; add goals as soon as you have enough detail (usually after 2-3 exchanges)
- Refine and update existing goals as you learn more — do not duplicate
- Each goal: title (max 8 words), description (1-2 sentences), successCriteria (one sentence on how they'll know it's done)

Always respond with valid JSON only — no text outside the JSON:
{"message":"your conversational response","goals":[{"title":"...","description":"...","successCriteria":"..."}]}
`.trim()

    const chatMessages = messages.length === 0
      ? [{ role: 'user', content: 'Please start the session with your greeting.' }]
      : messages

    const completion = await ollamaChat({
      messages: [{ role: 'system', content: system }, ...chatMessages],
      temperature: 0.6,
      json: true,
    })

    const parsed = parseChatResponse(getContent(completion), { goals: [] })

    res.json({
      message: parsed.message,
      goals:   Array.isArray(parsed.goals) ? parsed.goals : [],
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/planner/extract-goals — extract structured goals from transcript ─
router.post('/extract-goals', verifyToken, async (req, res) => {
  try {
    const { messages = [], month } = req.body || {}
    const monthLabel = toMonthLabel(month)

    const transcript = messages
      .map(msg => `${msg.role === 'user' ? 'Trainer' : 'Coach'}: ${msg.content}`)
      .join('\n\n')

    const completion = await ollamaChat({
      messages: [
        {
          role: 'system',
          content: `
You are a planning coach summarising a goal-setting conversation for a workplace trainer.
Extract 2-5 clear, actionable professional goals for ${monthLabel}.
Each goal must have:
- title: short name, max 8 words
- description: what they want to achieve, 1-2 sentences
- successCriteria: one concrete sentence — how they'll know it's done
Return ONLY valid JSON:
{"goals":[{"title":"...","description":"...","successCriteria":"..."}],"summary":"1-2 sentence overview of the month's focus"}
          `.trim(),
        },
        {
          role: 'user',
          content: `Planning conversation:\n\n${transcript}\n\nExtract the goals now.`,
        },
      ],
      temperature: 0.3,
      json: true,
    })

    const parsed = parseJSON(getContent(completion))
    if (!parsed.goals?.length) return res.status(400).json({ error: 'No goals could be extracted' })

    const inserted = await replaceGoals(req.userId, month, parsed.goals)
    res.json({ goals: inserted, summary: parsed.summary })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
