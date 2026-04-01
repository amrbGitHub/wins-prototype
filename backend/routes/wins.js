const { Router } = require('express')
const { ollamaChat, getContent, parseJSON } = require('../lib/ollama')

const router = Router()

// ── Shared helpers ────────────────────────────────────────────────────────────

const WIN_SYSTEM = `
You are a coaching assistant for a workplace trainer (L&D professional).
Critical rules:
- ONLY extract wins for people the trainer MENTIONS (learners, team members, participants, colleagues).
- NEVER extract a win for the trainer themselves. The trainer is the observer, not the subject.
- Do NOT invent facts. Use only what is in the input.
- Be practical, concise, and human.
Return ONLY valid JSON that matches the schema — no markdown, no explanation.
`.trim()

const WIN_TASK = `
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

async function extractWins(systemExtra, userContent) {
  const completion = await ollamaChat({
    messages: [
      { role: 'system', content: `${WIN_SYSTEM}\n${systemExtra}` },
      { role: 'user',   content: userContent },
    ],
    temperature: 0.3,
    json: true,
  })
  const parsed = parseJSON(getContent(completion))
  return {
    summary: parsed.summary || 'Summary unavailable.',
    wins:    Array.isArray(parsed.wins) ? parsed.wins : [],
  }
}

// ── POST /api/analyze — structured check-in → wins ───────────────────────────
router.post('/analyze', async (req, res) => {
  try {
    const { wentWell, wasHard, visibleWin, recognizeWho, outcome } = req.body || {}
    const result = await extractWins(
      'The trainer is writing about their week.',
      `Weekly check-in input (JSON):\n${JSON.stringify({ wentWell, wasHard, visibleWin, recognizeWho, outcome }, null, 2)}\n\n${WIN_TASK}`
    )
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/analyze-journal — free-form journal → wins ─────────────────────
router.post('/analyze-journal', async (req, res) => {
  try {
    const { text, type } = req.body || {}
    if (!text?.trim()) return res.status(400).json({ error: 'Missing journal text' })
    const label = type === 'weekly' ? 'weekly recap' : 'daily journal entry'
    const result = await extractWins(
      `The trainer has written a ${label}.`,
      `Journal entry (${label}):\n"""\n${text}\n"""\n\n${WIN_TASK}`
    )
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/draft — generate celebration message draft ─────────────────────
router.post('/draft', async (req, res) => {
  try {
    const { win, channel, tone, outcome, recognizeWho } = req.body || {}
    if (!win?.title || !win?.story) return res.status(400).json({ error: 'Missing win.title or win.story' })

    const completion = await ollamaChat({
      messages: [
        {
          role: 'system',
          content: `
You are a writing assistant for a workplace trainer (L&D professional).
Ghost-write a celebration message that the TRAINER will send.
- Write in the TRAINER'S voice, first person ("I wanted to share...", "I'm proud to highlight...").
- The message is addressed TO someone else (their team, participants, a manager, or leadership).
- NEVER address the trainer as the recipient.
- Use only the details provided; do not invent names, numbers, or claims not present.
- Match the requested channel and tone. Keep it ready-to-send.
Return ONLY the draft text — no markdown fences, no preamble, no sign-off name.
          `.trim(),
        },
        {
          role: 'user',
          content: `CHANNEL: ${channel}\nTONE: ${tone}\nOUTCOME: ${outcome}\nRECOGNIZE: ${recognizeWho || '(not provided)'}\n\nWIN:\nTitle: ${win.title}\nStory: ${win.story}\nEvidence: ${win.evidence || ''}\n\nWrite the draft now.`,
        },
      ],
      temperature: 0.5,
    })

    res.json({ draft: getContent(completion).trim() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/generate-message — celebrate a single win ──────────────────────
router.post('/generate-message', async (req, res) => {
  try {
    const { win, customRequest } = req.body || {}
    if (!win?.title || !win?.story) return res.status(400).json({ error: 'Missing win data' })

    const toneInstruction = customRequest?.trim()
      ? `Custom request from the trainer: ${customRequest.trim()}`
      : `Tone: Professional but warm and encouraging — genuine and approachable, not formal.`

    const completion = await ollamaChat({
      messages: [
        {
          role: 'system',
          content: `
You are a writing assistant for a workplace trainer (L&D professional).
Ghost-write a celebration message that the TRAINER will send.
- The message is written in the TRAINER'S voice, in first person.
- The message is addressed TO someone else — their team, participants, a manager, or leadership.
- NEVER address the trainer as the recipient.
- Use only the details provided; do not invent names, numbers, or claims not present.
- The message must be ready to send as-is — no subject lines, no placeholders like [Name].
- Be authentic and human, not corporate or stiff.
Return ONLY the message text — no markdown fences, no preamble, no sign-off name.
          `.trim(),
        },
        {
          role: 'user',
          content: `WIN TO CELEBRATE:\nTitle: ${win.title}\nStory: ${win.story}\nEvidence: ${win.evidence || ''}\n${win.celebrationIdeas?.length ? `Celebration ideas for context: ${win.celebrationIdeas.join('; ')}` : ''}\n\n${toneInstruction}\n\nWrite the message the trainer will send now.`,
        },
      ],
      temperature: 0.6,
    })

    res.json({ draft: getContent(completion).trim() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
