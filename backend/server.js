require('dotenv').config()

const express = require('express')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

const PORT = process.env.PORT || 8787
const ROUTELLM_API_KEY = process.env.ROUTELLM_API_KEY

if (!ROUTELLM_API_KEY) {
  console.error('Missing ROUTELLM_API_KEY in environment. Set it in backend/.env or your shell.')
  process.exit(1)
}

const ROUTELLM_BASE_URL = 'https://routellm.abacus.ai/v1'

// Helper: call RouteLLM Chat Completions
async function routeLLMChat({ model, messages, temperature = 0.4, response_format }) {
  const body = {
    model,
    messages,
    temperature,
  }
  if (response_format) body.response_format = response_format

  const resp = await fetch(`${ROUTELLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ROUTELLM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`RouteLLM error ${resp.status}: ${text}`)
  }

  return resp.json()
}

// 1) Analyze check-in -> wins + ideas
app.post('/api/analyze', async (req, res) => {
  try {
    const { wentWell, wasHard, visibleWin, recognizeWho, outcome } = req.body || {}

    const input = { wentWell, wasHard, visibleWin, recognizeWho, outcome }

    // Pick a model available in your RouteLLM plan.
    // If you have a preferred one, replace this string.
    const model = 'gpt-4.1-mini'

    const system = `
You are a coaching assistant for an internal L&D leader ("Josh") at a large organization.
Your job: detect concrete wins, capture evidence, and suggest simple celebration actions.
Be practical, concise, and human. Do NOT invent facts. Use only the user's input.
Return STRICT JSON only that matches the schema requested.
`.trim()

    const user = `
Weekly check-in input (JSON):
${JSON.stringify(input, null, 2)}

TASK:
1) Write a 1-2 sentence summary.
2) Extract 1 to 3 wins. Each win must have:
- id (short string)
- title (max 10 words)
- story (1-2 sentences)
- evidence (1 sentence, based on input)
- celebrationIdeas (2-4 bullet items as strings; specific actions)
`.trim()

    const completion = await routeLLMChat({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      // Ask for JSON output if supported by the upstream model.
      response_format: { type: 'json_object' },
    })

    const content = completion?.choices?.[0]?.message?.content
    let parsed
    try {
      parsed = JSON.parse(content)
    } catch {
      // Fallback if model didn't comply perfectly
      return res.status(500).send(`Model did not return valid JSON:\n${content}`)
    }

    // Light validation / defaults
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

    const model = 'gpt-4.1-mini'

    const system = `
You write celebration drafts for an L&D leader.
Rules:
- Use the details provided; do not add names, metrics, or claims not present.
- Keep it ready-to-send.
- Match the requested channel and tone.
Return ONLY the draft text (no markdown fences).
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

    const completion = await routeLLMChat({
      model,
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

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`)
})