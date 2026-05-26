const { Router } = require('express')
const { supabase } = require('../config')
const { verifyToken } = require('../middleware/auth')
const { ollamaChatStream, parseChatResponse } = require('../lib/ollama')
const { dbGoalToShape, dbProgramToShape } = require('../lib/shapes')
const { resolveActions, messageClaimsAction, detectUserIntent, validateIntentMatch, synthesizeRenameAction } = require('../lib/actionResolver')
const { LC_RESPONSE_SCHEMA, buildCheckinSystem } = require('../prompts/lc')
const { buildGatewaySystem } = require('../prompts/lc-gateway')
const { redactText, canonicalizeMappings, applyCanonicals, rehydrateText } = require('../lib/redactor')
const { claudeChatStream } = require('../lib/claude')

const router = Router()

// Feature flag: when LC_GATEWAY_ENABLED is set, route LC chat through the
// Claude-via-pseudonymization-gateway path. When unset, fall back to the
// existing Ollama path. Lets us A/B locally and roll back without code changes.
const GATEWAY_ENABLED = process.env.LC_GATEWAY_ENABLED === 'true'

// When true, log every gateway turn's redacted payload to the backend terminal
// so you can watch PII pseudonymization happen in real time while testing.
// Off by default to keep production logs clean.
const GATEWAY_DEBUG = process.env.LC_GATEWAY_DEBUG === 'true'

// Lightweight preview endpoint: lets you POST text and see exactly what the
// redactor would produce — no Claude call, no DB write. Useful for tuning the
// redactor while crafting test prompts. Bypasses persistence on purpose.
// Note: mounted only when gateway is enabled.
if (GATEWAY_ENABLED) {
  router.post('/preview-redaction', verifyToken, async (req, res) => {
    try {
      const { text = '' } = req.body || {}
      const { redactText } = require('../lib/redactor')
      const result = await redactText(String(text))
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Global wipe: drop every pseudonym registry row for this user. Used by the
  // "Clear LC memory" settings button. After this, the next mention of "James"
  // mints a fresh pseudonym — Claude no longer has continuity. Irreversible.
  router.post('/clear-pseudonyms', verifyToken, async (req, res) => {
    try {
      const { error, count } = await supabase
        .from('pseudonym_registry')
        .delete({ count: 'exact' })
        .eq('user_id', req.userId)
      if (error) throw error
      res.json({ deleted: count ?? 0 })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })
}

// POST /api/elsie/chat — LC (Learning Companion) streaming chat
// (route path kept for backwards compatibility; user-facing name is "LC")
router.post('/chat', verifyToken, async (req, res) => {
  try {
    const { messages = [], firstName = '', conversationId = null } = req.body || {}

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

    const chatMessages = messages.length === 0
      ? [{ role: 'user', content: 'Please start this new chat with a short friendly greeting and ask what I would like help with.' }]
      : messages

    // ── SSE streaming ─────────────────────────────────────────────────────────
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    // ── Gateway path: Claude via PII pseudonymization ─────────────────────────
    // When enabled, we redact each message in history, route to Claude, and
    // rehydrate the streamed response. No actions, no JSON schema — pure
    // advisory conversation. Returns early; the local Ollama path below is
    // unchanged when the flag is off.
    if (GATEWAY_ENABLED) {
      try {
        await handleGatewayTurn({
          res, userId: req.userId, conversationId, chatMessages,
          // The user's own first name is NOT PII to themselves and Claude
          // already knows it via the system prompt. Skip-list it so we don't
          // pointlessly pseudonymize the assistant's greetings.
          skipNames: [nameStr].filter(n => n && n !== 'there'),
          systemArgs: { nameStr, goalsCtx, programsCtx, reflectionCtx, todayCtx },
        })
      } catch (err) {
        res.write(`data: ${JSON.stringify({ error: `gateway: ${err.message}` })}\n\n`)
        res.end()
      }
      return
    }

    const system = buildCheckinSystem({ nameStr, goalsCtx, programsCtx, reflectionCtx, todayCtx })

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

// ── Gateway handler ─────────────────────────────────────────────────────────
// Runs when LC_GATEWAY_ENABLED=true. Redacts the entire message history
// (user AND assistant — assistant messages were rehydrated to real names
// before being stored, so they contain PII on the way back to us), resolves
// canonical pseudonyms via the registry, streams Claude's response with
// safe-buffer rehydration, and sends a final done event with the full
// rehydrated message.
//
// Safe-buffer rehydration: pseudonyms could be split across Claude's streaming
// deltas (e.g. "Person_" then "4F2C" in two chunks). We hold back the trailing
// HOLD_BACK chars of the running buffer from the rehydrated stream, then flush
// the held tail when the stream ends. HOLD_BACK > max pseudonym length.
async function handleGatewayTurn({ res, userId, conversationId, chatMessages, skipNames = [], systemArgs }) {
  const HOLD_BACK = 32  // any pseudonym is ≤ ~15 chars; 32 is a safe margin

  // 1. Redact each message. Collect (role, redactedText, mappings).
  const perMessage = []
  for (const m of chatMessages) {
    const { redactedText, mappings } = await redactText(m.content || '', { skipNames })
    perMessage.push({ role: m.role, redactedText, mappings })
  }

  // 2. Canonicalize ALL mappings in one batch against the registry.
  const allMappings = perMessage.flatMap(p => p.mappings)
  const { canonicalsByKey, registryIdsByKey } = await canonicalizeMappings(userId, allMappings)

  // 2b. Best-effort link the pseudonyms used this turn to the conversation
  // (for orphan-GC on conversation delete). Skip silently if no conversationId
  // was provided (e.g. first-turn before the conversation is created) — those
  // pseudonyms still exist in the registry, just unlinked. The global wipe
  // button is the fallback for cleaning up unlinked entries.
  if (conversationId && registryIdsByKey.size > 0) {
    const junctionRows = [...registryIdsByKey.values()].map(id => ({
      conversation_id: conversationId,
      pseudonym_registry_id: id,
    }))
    const { error: jErr } = await supabase
      .from('lc_conversation_pseudonyms')
      .upsert(junctionRows, { onConflict: 'conversation_id,pseudonym_registry_id', ignoreDuplicates: true })
    if (jErr) console.warn('[gateway] junction insert failed (non-fatal):', jErr.message)
  }

  // 3. Rewrite each message to use canonical pseudonyms. Build the array
  //    that goes to Claude.
  const claudeMessages = perMessage.map(p => ({
    role:    p.role,
    content: applyCanonicals(p.redactedText, p.mappings, canonicalsByKey),
  }))

  // Real-time debug view — see what's actually going to Claude.
  // Splits PII into "new this turn" (from the user's latest message) vs
  // "from history" (already-pseudonymized references being re-sent for context).
  // The from-history entries are NOT new leaks — they're the same persisted
  // pseudonyms Claude has seen before — but they always appear in the payload
  // because we re-redact the whole history each turn.
  if (GATEWAY_DEBUG) {
    const last         = chatMessages[chatMessages.length - 1]
    const lastRedacted = claudeMessages[claudeMessages.length - 1]
    const latestMappings = perMessage[perMessage.length - 1]?.mappings || []
    const historyMappings = perMessage.slice(0, -1).flatMap(p => p.mappings)
    const fmt = m => `${m.real}(${m.type})→${canonicalsByKey.get(`${m.type}:${m.real.toLowerCase()}`)}`
    const dedupe = arr => [...new Map(arr.map(m => [`${m.type}:${m.real.toLowerCase()}`, m])).values()]

    console.log('\n┌── LC gateway turn ─────────────────────────────────────')
    console.log(`│ USER:        ${last?.content || ''}`)
    console.log(`│ TO CLAUDE:   ${lastRedacted?.content || ''}`)
    const newPII = dedupe(latestMappings)
    const histPII = dedupe(historyMappings).filter(h =>
      !newPII.some(n => `${n.type}:${n.real.toLowerCase()}` === `${h.type}:${h.real.toLowerCase()}`)
    )
    console.log(`│ NEW PII:     ${newPII.length ? newPII.map(fmt).join(', ') : '(none)'}`)
    console.log(`│ FROM HIST:   ${histPII.length ? histPII.map(fmt).join(', ') : '(none)'}`)
    console.log('└────────────────────────────────────────────────────────')
  }

  // 4. Build the lookup we'll use to rehydrate Claude's response back to
  //    real names: canonical pseudonym → real value.
  const rehydrationMappings = []
  const seen = new Set()
  for (const m of allMappings) {
    const key = `${m.type}:${m.real.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    const canonical = canonicalsByKey.get(key)
    if (canonical) rehydrationMappings.push({ pseudonym: canonical, real: m.real })
  }

  // 5. Build Claude system prompt and stream.
  const system = buildGatewaySystem(systemArgs)
  let buffer = ''
  let flushedUpTo = 0
  let fullPseudoText = ''

  for await (const delta of claudeChatStream({ system, messages: claudeMessages })) {
    buffer += delta
    fullPseudoText += delta
    const safeEnd = Math.max(flushedUpTo, buffer.length - HOLD_BACK)
    if (safeEnd > flushedUpTo) {
      const flushedSlice = buffer.slice(flushedUpTo, safeEnd)
      const rehydrated = rehydrateText(flushedSlice, rehydrationMappings)
      res.write(`data: ${JSON.stringify({ delta: rehydrated })}\n\n`)
      flushedUpTo = safeEnd
    }
  }
  // Flush the held tail.
  const tail = buffer.slice(flushedUpTo)
  if (tail) {
    const rehydratedTail = rehydrateText(tail, rehydrationMappings)
    res.write(`data: ${JSON.stringify({ delta: rehydratedTail })}\n\n`)
  }

  // 6. Final done event with the full rehydrated message. Frontend uses this
  //    to overwrite/finalize the streamed text and store in chat history.
  const fullMessage = rehydrateText(fullPseudoText, rehydrationMappings)
  res.write(`data: ${JSON.stringify({
    done:    true,
    message: fullMessage,
    actions: [],      // gateway path: no actions, advisory only
    failed:  false,
    errorMsg: null,
    dropped: [],
    intent:  null,
    synthesized: false,
  })}\n\n`)
  res.end()
}

module.exports = router
