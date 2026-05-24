const { Router } = require('express')
const { supabase } = require('../config')
const { verifyToken } = require('../middleware/auth')
const { ollamaChatStream, parseChatResponse } = require('../lib/ollama')
const { dbGoalToShape, dbProgramToShape } = require('../lib/shapes')
const { resolveActions, messageClaimsAction, detectUserIntent, validateIntentMatch, synthesizeRenameAction } = require('../lib/actionResolver')
const { LC_RESPONSE_SCHEMA, buildCheckinSystem } = require('../prompts/lc')

const router = Router()

// POST /api/elsie/chat — LC (Learning Companion) streaming chat
// (route path kept for backwards compatibility; user-facing name is "LC")
router.post('/chat', verifyToken, async (req, res) => {
  try {
    const { messages = [], firstName = '' } = req.body || {}

    // Fetch active goals + active/completed programs + last reflection for context
    const [goalsResult, programsResult, reflectionsResult] = await Promise.all([
      supabase.from('goals').select('*').eq('user_id', req.userId)
        .eq('status', 'active').order('created_at', { ascending: true }),
      supabase.from('programs').select('*').eq('user_id', req.userId)
        .in('status', ['active', 'completed']).order('updated_at', { ascending: false }),
      supabase.from('reflections').select('month,evaluation,suggestions,created_at')
        .eq('user_id', req.userId).order('created_at', { ascending: false }).limit(1),
    ])

    const goals = (goalsResult.data || []).map(dbGoalToShape)
    const programs = (programsResult.data || []).map(dbProgramToShape)
    const lastReflection = reflectionsResult.data?.[0] || null

    const nameStr  = firstName || 'there'
    const goalsCtx = goals.length
      ? goals.map(g =>
          `  - ID: ${g.id}\n    Title: ${g.title}\n    Progress: ${g.progress}%` +
          (g.description ? `\n    Description: ${g.description}` : '') +
          (g.programId ? `\n    Program: ${programs.find(p => p.id === g.programId)?.name || '(unknown)'}` : '')
        ).join('\n')
      : '  (No active goals set yet this month)'

    const programsCtx = programs.length
      ? programs.map(p =>
          `  - ID: ${p.id}\n    Name: ${p.name}\n    Status: ${p.status}` +
          (p.description ? `\n    Description: ${p.description}` : '')
        ).join('\n')
      : '  (No programs set up yet — they\'re optional)'

    const reflectionCtx = lastReflection
      ? `Last reflection (${lastReflection.month}): ${lastReflection.evaluation || ''}${
          Array.isArray(lastReflection.suggestions) && lastReflection.suggestions.length
            ? `\nSuggestions from that review: ${lastReflection.suggestions.join('; ')}`
            : ''
        }`
      : '  (No reflections yet)'

    // Today's date for natural-language date parsing in actions (e.g. "next Friday")
    const now = new Date()
    const todayIso = now.toISOString().slice(0, 10)
    const todayDow = now.toLocaleDateString('en-US', { weekday: 'long' })
    const todayCtx = `Today is ${todayDow}, ${todayIso}.`

    const system = buildCheckinSystem({ nameStr, goalsCtx, programsCtx, reflectionCtx, todayCtx })

    const chatMessages = messages.length === 0
      ? [{ role: 'user', content: 'Please start this new chat with a short friendly greeting and ask what I would like help with.' }]
      : messages

    // ── SSE streaming ─────────────────────────────────────────────────────────
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    let fullContent = ''
    try {
      for await (const delta of ollamaChatStream({
        messages: [{ role: 'system', content: system }, ...chatMessages],
        temperature: 0.2,                  // tool use needs determinism, not creativity
        jsonSchema: LC_RESPONSE_SCHEMA,    // structured-output mode: forces shape
      })) {
        fullContent += delta
        res.write(`data: ${JSON.stringify({ delta })}\n\n`)
      }
    } catch (streamErr) {
      res.write(`data: ${JSON.stringify({ error: streamErr.message })}\n\n`)
      res.end()
      return
    }

    const parsed = parseChatResponse(fullContent, { actions: [] })
    const rawActions = Array.isArray(parsed.actions) ? parsed.actions : []

    // Resolve every action against ground truth: fuzzy-match goalRef → goalId
    // and programRef → programId, snap status synonyms, drop blank fields.
    // Anything unrepairable is dropped.
    const { actions, dropped } = resolveActions(rawActions, goals, programs)

    // ── Failure detection ────────────────────────────────────────────────────
    // Three layers, in order of specificity:
    //   1. Intent mismatch — user asked X, model emitted Y. Most reliable signal.
    //   2. Lie + no actions — message claims action, actions array is empty.
    //   3. Lie + dropped actions — message claims action, all actions got dropped.
    let message = parsed.message || ''
    let failed   = false
    let errorMsg = null

    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content
    const intent = detectUserIntent(lastUserMessage)
    const intentCheck = validateIntentMatch(intent, actions)
    let synthesized = false

    if (!intentCheck.ok) {
      // Escape hatch for rename — the most common LLM failure mode. Parse the
      // user's message directly and synthesize the canonical action. If we
      // succeed, the user gets a working rename instead of a failure card.
      if (intent === 'rename') {
        const synth = synthesizeRenameAction(lastUserMessage, goals)
        if (synth.ok) {
          actions.push(synth.action)
          // Replace the (likely wrong) model message with one that matches what we did
          message = `Renamed — '${synth.action.goalTitle}' is now '${synth.action.title}'.`
          synthesized = true
        } else {
          failed = true
          errorMsg = `${intentCheck.reason} (Auto-correction also failed: ${synth.reason}.)`
        }
      } else {
        failed = true
        errorMsg = intentCheck.reason
      }
    } else if (rawActions.length && !actions.length && messageClaimsAction(message)) {
      failed = true
      errorMsg = 'LC said it acted but the action couldn\'t be resolved against your goals.'
    } else if (messageClaimsAction(message) && rawActions.length === 0) {
      failed = true
      errorMsg = 'LC said it acted but didn\'t actually emit the action.'
    }

    res.write(`data: ${JSON.stringify({
      done:     true,
      message,
      actions,
      failed,
      errorMsg,
      dropped,
      intent,        // diagnostic: what we thought the user wanted
      synthesized,   // diagnostic: did we bypass the model and build the action ourselves
    })}\n\n`)
    res.end()
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message })
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
      res.end()
    }
  }
})

module.exports = router
