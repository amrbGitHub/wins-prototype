require('dotenv').config()

const express = require('express')
const cors = require('cors')
const { createClient } = require('@supabase/supabase-js')

const app = express()

// Normalise to remove trailing slashes; support "*." wildcard prefix patterns
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',').map(s => s.trim().replace(/\/$/, ''))

function originAllowed(origin) {
  if (!origin) return true // curl / server-to-server
  const o = origin.replace(/\/$/, '')
  return ALLOWED_ORIGINS.some(pattern => {
    if (pattern.startsWith('*.')) {
      // wildcard subdomain: *.vercel.app matches anything.vercel.app
      return o.endsWith(pattern.slice(1))
    }
    return o === pattern
  })
}

app.use(cors({
  origin: (origin, cb) => {
    if (originAllowed(origin)) return cb(null, true)
    cb(new Error(`CORS: origin ${origin} not allowed`))
  },
}))
app.use(express.json({ limit: '1mb' }))

const PORT = process.env.PORT || 8787
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2'

// Supabase admin client (service role — bypasses RLS, server-side only)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
// Auth middleware: verify Supabase JWT via Supabase's own auth API
async function verifyToken(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' })
  }
  try {
    const { data: { user }, error } = await supabase.auth.getUser(header.slice(7))
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token', detail: error?.message })
    }
    req.userId = user.id
    next()
  } catch (err) {
    console.error('verifyToken error:', err.message)
    return res.status(401).json({ error: 'Invalid or expired token', detail: err.message })
  }
}

// Map DB snake_case goal row → frontend shape
function dbGoalToShape(row) {
  return {
    id:              row.id,
    month:           row.month,
    title:           row.title,
    description:     row.description,
    successCriteria: row.success_criteria,
    status:          row.status,
    createdAt:       new Date(row.created_at).getTime(),
  }
}

// Map DB snake_case row → frontend camelCase shape (matches existing localStorage shape)
function dbRowToEntry(row) {
  return {
    id:             row.id,
    date:           row.date,
    type:           row.type,
    text:           row.text,
    analysis:       row.analysis,
    analysisFailed: row.analysis_failed,
    createdAt:      new Date(row.created_at).getTime(),
  }
}

// Helper: call Ollama via its OpenAI-compatible chat completions endpoint
async function ollamaChat({ messages, temperature = 0.4, json = false }) {
  const body = {
    model: OLLAMA_MODEL,
    messages,
    temperature,
    stream: false,
  }
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
    // Network-level failure (tunnel down, DNS error, connection refused, etc.)
    const cause = err.cause?.message ?? err.cause ?? ''
    throw new Error(`Ollama unreachable at ${OLLAMA_BASE_URL}: ${err.message}${cause ? ` (${cause})` : ''}`)
  }

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Ollama error ${resp.status} at ${OLLAMA_BASE_URL}/chat/completions: ${text}`)
  }

  return resp.json()
}

// Helper: extract and parse JSON from model output (strips markdown fences if present)
function parseJSON(content) {
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  return JSON.parse(cleaned)
}

// ── Journal entry CRUD ────────────────────────────────────────────────────────

// GET /api/entries — fetch all entries for the authenticated user
app.get('/api/entries', verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('journal_entries')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })

    if (error) throw error
    res.json(data.map(dbRowToEntry))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/entries — create a new entry (no analysis yet)
app.post('/api/entries', verifyToken, async (req, res) => {
  try {
    const { date, type, text } = req.body || {}
    if (!text?.trim()) return res.status(400).json({ error: 'Missing text' })

    const { data, error } = await supabase
      .from('journal_entries')
      .insert({
        user_id:         req.userId,
        date,
        type,
        text:            text.trim(),
        analysis:        null,
        analysis_failed: false,
      })
      .select()
      .single()

    if (error) throw error
    res.status(201).json(dbRowToEntry(data))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/entries/:id/analysis — persist analysis result or failure flag
app.patch('/api/entries/:id/analysis', verifyToken, async (req, res) => {
  try {
    const { analysis, analysisFailed } = req.body || {}
    const updatePayload = {}
    if (analysis !== undefined)       updatePayload.analysis        = analysis
    if (analysisFailed !== undefined) updatePayload.analysis_failed = analysisFailed

    const { data, error } = await supabase
      .from('journal_entries')
      .update(updatePayload)
      .eq('id', req.params.id)
      .eq('user_id', req.userId)  // prevents touching another user's entry
      .select()
      .single()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Entry not found' })
    res.json(dbRowToEntry(data))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/entries/:id — delete an entry
app.delete('/api/entries/:id', verifyToken, async (req, res) => {
  try {
    const { error } = await supabase
      .from('journal_entries')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.userId)

    if (error) throw error
    res.status(204).send()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── AI endpoints (unchanged) ──────────────────────────────────────────────────

// 1) Analyze check-in -> wins + ideas
app.post('/api/analyze', async (req, res) => {
  try {
    const { wentWell, wasHard, visibleWin, recognizeWho, outcome } = req.body || {}

    const input = { wentWell, wasHard, visibleWin, recognizeWho, outcome }

    const system = `
You are a coaching assistant for a workplace trainer (L&D professional).
The trainer is writing about their week. Your job is to identify wins belonging to the PEOPLE THE TRAINER WORKS WITH — their learners, team members, or participants.

Critical rules:
- ONLY extract wins for people the trainer MENTIONS (learners, team members, participants, colleagues).
- NEVER extract a win for the trainer themselves. The trainer is the observer, not the subject.
- If something positive happened for the trainer personally (e.g. "I finally got my admin done"), ignore it — it is not a win to celebrate here.
- Do NOT invent facts. Use only what is in the input.
- Be practical, concise, and human.
Return ONLY valid JSON that matches the schema — no markdown, no explanation.
`.trim()

    const user = `
Weekly check-in input (JSON):
${JSON.stringify(input, null, 2)}

TASK:
1) Write a 1-2 sentence summary focused on the people the trainer works with.
2) Extract 1 to 3 wins belonging to the trainer's learners or team members. Each win must have:
- id (short string, no spaces)
- title (max 10 words, describing the learner/team member's win)
- story (1-2 sentences about what that person or group achieved)
- evidence (1 sentence of evidence from the input)
- celebrationIdeas (array of 2-4 strings; specific actions to celebrate that person or group)

If no wins for other people are mentioned, return an empty wins array.

Return JSON in this exact shape:
{"summary":"...","wins":[{"id":"...","title":"...","story":"...","evidence":"...","celebrationIdeas":["...","..."]}]}
`.trim()

    const completion = await ollamaChat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      json: true,
    })

    const content = completion?.choices?.[0]?.message?.content
    let parsed
    try {
      parsed = parseJSON(content)
    } catch {
      return res.status(500).send(`Model did not return valid JSON:\n${content}`)
    }

    if (!parsed.wins) parsed.wins = []
    res.json({
      summary: parsed.summary || 'Summary unavailable.',
      wins: parsed.wins,
    })
  } catch (err) {
    res.status(500).send(err.message)
  }
})

// 2) Generate a draft for a selected win
app.post('/api/draft', async (req, res) => {
  try {
    const { win, channel, tone, outcome, recognizeWho } = req.body || {}
    if (!win?.title || !win?.story) return res.status(400).send('Missing win.title or win.story')

    const system = `
You are a writing assistant for a workplace trainer (L&D professional).
Ghost-write a celebration message that the TRAINER will send.

Critical context:
- The TRAINER is the sender — they observed or facilitated the win.
- Write in the TRAINER'S voice, first person ("I wanted to share...", "I'm proud to highlight...").
- The message is addressed TO someone else (their team, participants, a manager, or leadership).
- NEVER address the trainer as the recipient. NEVER write to the trainer.
- Use only the details provided; do not invent names, numbers, or claims not present.
- Match the requested channel and tone. Keep it ready-to-send.
Return ONLY the draft text — no markdown fences, no preamble, no sign-off name.
`.trim()

    const user = `
CHANNEL: ${channel}
TONE: ${tone}
OUTCOME: ${outcome}
RECOGNIZE: ${recognizeWho || '(not provided)'}

WIN:
Title: ${win.title}
Story: ${win.story}
Evidence: ${win.evidence || ''}

Write the draft now.
`.trim()

    const completion = await ollamaChat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.5,
    })

    const draft = completion?.choices?.[0]?.message?.content?.trim() || ''
    res.json({ draft })
  } catch (err) {
    res.status(500).send(err.message)
  }
})

// 3) Analyze a free-form journal entry -> wins + ideas
app.post('/api/analyze-journal', async (req, res) => {
  try {
    const { text, type } = req.body || {}
    if (!text?.trim()) return res.status(400).send('Missing journal text')

    const entryLabel = type === 'weekly' ? 'weekly recap' : 'daily journal entry'

    const system = `
You are a coaching assistant for a workplace trainer (L&D professional).
The trainer has written a ${entryLabel}. Your job is to surface wins belonging to the PEOPLE THE TRAINER WORKS WITH — their learners, team members, or participants.

Critical rules:
- ONLY extract wins for people the trainer MENTIONS (learners, team members, participants, colleagues by name or as a group).
- NEVER extract a win for the trainer themselves. The trainer is the observer and facilitator, not the subject.
- If the trainer mentions something positive about their own work or day (e.g. "I finally got my lesson plan finished"), ignore it — it is not a win to track here.
- Do NOT invent facts — use only what is in the entry.
- Be practical, concise, and human.
Return ONLY valid JSON that matches the schema — no markdown, no explanation.
`.trim()

    const user = `
Journal entry (${entryLabel}):
"""
${text}
"""

TASK:
1) Write a 1-2 sentence summary focused on the people the trainer works with and what they achieved.
2) Extract 1 to 3 wins belonging to the trainer's learners or team members. Each win must have:
- id (short string, no spaces)
- title (max 10 words, describing what the learner or group achieved)
- story (1-2 sentences about what that person or group did)
- evidence (1 sentence of evidence drawn from the entry)
- celebrationIdeas (array of 2-4 strings; specific, actionable ways to celebrate that person or group)

If no wins for other people are described, return an empty wins array.

Return JSON in this exact shape:
{"summary":"...","wins":[{"id":"...","title":"...","story":"...","evidence":"...","celebrationIdeas":["...","..."]}]}
`.trim()

    const completion = await ollamaChat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      json: true,
    })

    const content = completion?.choices?.[0]?.message?.content
    let parsed
    try {
      parsed = parseJSON(content)
    } catch {
      return res.status(500).send(`Model did not return valid JSON:\n${content}`)
    }

    if (!parsed.wins) parsed.wins = []
    res.json({
      summary: parsed.summary || 'Summary unavailable.',
      wins: parsed.wins,
    })
  } catch (err) {
    res.status(500).send(err.message)
  }
})

// 4) Generate a celebration message for a single win (from the Celebrate tab)
app.post('/api/generate-message', async (req, res) => {
  try {
    const { win, customRequest } = req.body || {}
    if (!win?.title || !win?.story) return res.status(400).send('Missing win data')

    const hasCustom = customRequest?.trim()

    const system = `
You are a writing assistant for a workplace trainer (L&D professional).
Your job is to ghost-write a celebration message that the TRAINER will send.

Critical context:
- The TRAINER is the one sending this message — they observed or facilitated the win.
- The message is written in the TRAINER'S voice, in first person ("I wanted to share...", "I've been so impressed by...").
- The message is addressed TO someone else — their team, participants, a manager, or leadership.
- NEVER address the trainer as the recipient. NEVER write "Dear [trainer]" or speak to the trainer.
- The trainer is celebrating a win they witnessed in their learners or team.
- Use only the details provided; do not invent names, numbers, or claims not present.
- The message must be ready to send as-is — no subject lines, no placeholders like [Name].
- Be authentic and human, not corporate or stiff.
Return ONLY the message text — no markdown fences, no preamble, no sign-off name.
`.trim()

    const toneInstruction = hasCustom
      ? `Custom request from the trainer: ${hasCustom}`
      : `Tone: Professional but warm and encouraging — genuine and approachable, not formal. Suitable for sending to a team, manager, or colleague.`

    const user = `
WIN TO CELEBRATE:
Title: ${win.title}
Story: ${win.story}
Evidence: ${win.evidence || ''}
${win.celebrationIdeas?.length ? `Celebration ideas for context: ${win.celebrationIdeas.join('; ')}` : ''}

${toneInstruction}

Write the message the trainer will send now.
`.trim()

    const completion = await ollamaChat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.6,
    })

    const draft = completion?.choices?.[0]?.message?.content?.trim() || ''
    res.json({ draft })
  } catch (err) {
    res.status(500).send(err.message)
  }
})

// ── Planner endpoints ─────────────────────────────────────────────────────────

// GET /api/planner/:month — load session (messages) for a month
app.get('/api/planner/:month', verifyToken, async (req, res) => {
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

// POST /api/planner/session — upsert session (persist messages after each turn)
app.post('/api/planner/session', verifyToken, async (req, res) => {
  try {
    const { month, messages, readyToExtract } = req.body || {}
    const { error } = await supabase
      .from('planner_sessions')
      .upsert({ user_id: req.userId, month, messages, ready_to_extract: readyToExtract ?? false },
               { onConflict: 'user_id,month' })
    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/planner/chat — stateless AI turn (no auth required)
app.post('/api/planner/chat', async (req, res) => {
  try {
    const { messages = [], month } = req.body || {}
    const [y, m] = (month || '').split('-')
    const monthLabel = y && m
      ? new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : 'this month'

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
- Acknowledge what they share before asking the next question
- Ask follow-up questions if an answer is vague
- After 4-6 meaningful exchanges where you have a clear picture, set readyToExtract to true
- If this is the opening message (no prior messages), greet them briefly and ask your first question

Always respond with valid JSON only:
{"message":"your response here","readyToExtract":false}

Set readyToExtract to true ONLY when you have enough to write 2-4 clear, actionable goals.
`.trim()

    const completion = await ollamaChat({
      messages: [{ role: 'system', content: system }, ...messages],
      temperature: 0.6,
      json: true,
    })

    const content = completion?.choices?.[0]?.message?.content
    let parsed
    try {
      parsed = parseJSON(content)
    } catch {
      parsed = { message: content?.trim() || 'Sorry, I had trouble responding. Please try again.', readyToExtract: false }
    }

    res.json({ message: parsed.message || '', readyToExtract: !!parsed.readyToExtract })
  } catch (err) {
    res.status(500).send(err.message)
  }
})

// POST /api/planner/extract-goals — extract structured goals and save to DB
app.post('/api/planner/extract-goals', verifyToken, async (req, res) => {
  try {
    const { messages = [], month } = req.body || {}
    const [y, m] = (month || '').split('-')
    const monthLabel = y && m
      ? new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : 'this month'

    const system = `
You are a planning coach summarising a goal-setting conversation for a workplace trainer.
Extract 2-5 clear, actionable professional goals for ${monthLabel}.

Each goal must have:
- title: short name, max 8 words
- description: what they want to achieve, 1-2 sentences
- successCriteria: one concrete sentence — how they'll know it's done

Return ONLY valid JSON:
{"goals":[{"title":"...","description":"...","successCriteria":"..."}],"summary":"1-2 sentence overview of the month's focus"}
`.trim()

    const transcript = messages
      .map(msg => `${msg.role === 'user' ? 'Trainer' : 'Coach'}: ${msg.content}`)
      .join('\n\n')

    const completion = await ollamaChat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Planning conversation:\n\n${transcript}\n\nExtract the goals now.` },
      ],
      temperature: 0.3,
      json: true,
    })

    const content = completion?.choices?.[0]?.message?.content
    const parsed = parseJSON(content)
    if (!parsed.goals?.length) return res.status(400).json({ error: 'No goals could be extracted' })

    // Replace any existing goals for this month
    await supabase.from('goals').delete().eq('user_id', req.userId).eq('month', month)

    const { data, error } = await supabase
      .from('goals')
      .insert(parsed.goals.map(g => ({
        user_id:          req.userId,
        month,
        title:            g.title,
        description:      g.description,
        success_criteria: g.successCriteria,
        status:           'active',
      })))
      .select()
    if (error) throw error

    res.json({ goals: data.map(dbGoalToShape), summary: parsed.summary })
  } catch (err) {
    res.status(500).send(err.message)
  }
})

// ── Goals endpoints ───────────────────────────────────────────────────────────

// GET /api/goals — fetch goals, optional ?month=YYYY-MM filter
app.get('/api/goals', verifyToken, async (req, res) => {
  try {
    let query = supabase
      .from('goals')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: true })
    if (req.query.month) query = query.eq('month', req.query.month)
    const { data, error } = await query
    if (error) throw error
    res.json(data.map(dbGoalToShape))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/goals/:id — update goal status
app.patch('/api/goals/:id', verifyToken, async (req, res) => {
  try {
    const { status } = req.body || {}
    const { data, error } = await supabase
      .from('goals')
      .update({ status })
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select()
      .single()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Goal not found' })
    res.json(dbGoalToShape(data))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`)
  console.log(`Using Ollama model: ${OLLAMA_MODEL} at ${OLLAMA_BASE_URL}`)
})
