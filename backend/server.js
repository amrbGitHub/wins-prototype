require('dotenv').config()

const express = require('express')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

const PORT = process.env.PORT || 8787
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2'

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

// 1) Analyze check-in -> wins + ideas
app.post('/api/analyze', async (req, res) => {
  try {
    const { wentWell, wasHard, visibleWin, recognizeWho, outcome } = req.body || {}

    const input = { wentWell, wasHard, visibleWin, recognizeWho, outcome }

    const system = `
You are a coaching assistant for an internal L&D leader at a large organization.
Your job: detect concrete wins, capture evidence, and suggest simple celebration actions.
Be practical, concise, and human. Do NOT invent facts. Use only the user's input.
Return ONLY valid JSON that matches the schema requested — no markdown, no explanation.
`.trim()

    const user = `
Weekly check-in input (JSON):
${JSON.stringify(input, null, 2)}

TASK:
1) Write a 1-2 sentence summary.
2) Extract 1 to 3 wins. Each win must have:
- id (short string, no spaces)
- title (max 10 words)
- story (1-2 sentences)
- evidence (1 sentence, based on input)
- celebrationIdeas (array of 2-4 strings; specific celebration actions)

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
You are a coaching assistant for an internal L&D leader at a large organization.
Your job: read a ${entryLabel} and surface concrete wins, evidence, and celebration ideas.
Be practical, concise, and human. Do NOT invent facts — use only what is in the entry.
Return ONLY valid JSON that matches the schema — no markdown, no explanation.
`.trim()

    const user = `
Journal entry (${entryLabel}):
"""
${text}
"""

TASK:
1) Write a 1-2 sentence summary of the entry.
2) Extract 1 to 3 wins. Each win must have:
- id (short string, no spaces)
- title (max 10 words)
- story (1-2 sentences)
- evidence (1 sentence based on the entry)
- celebrationIdeas (array of 2-4 strings; specific, actionable celebration ideas)

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
