require('dotenv').config()

const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken')
const { createClient } = require('@supabase/supabase-js')

const app = express()

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',').map(s => s.trim())

app.use(cors({
  origin: (origin, cb) => {
    // Allow no-origin requests (curl, server-to-server) and listed origins
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
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
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET

// Auth middleware: verify Supabase JWT and attach userId to req
function verifyToken(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' })
  }
  try {
    const decoded = jwt.verify(header.slice(7), JWT_SECRET, { algorithms: ['HS256'] })
    req.userId = decoded.sub  // Supabase user UUID
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
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

  const resp = await fetch(`${OLLAMA_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Ollama error ${resp.status}: ${text}`)
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

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`)
  console.log(`Using Ollama model: ${OLLAMA_MODEL} at ${OLLAMA_BASE_URL}`)
})
