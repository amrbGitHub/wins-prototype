// LC chat route — Claude/DeepSeek via the local PII gateway.
//
// One path, one shape:
//   1. Redact every message in history (per-user pseudonym map, encrypted at rest).
//   2. Fetch long-term notes for every entity in the conversation.
//   3. Call the model with redacted history + tool definitions + injected summaries.
//   4. Stream prose deltas (rehydrated to real names) to the frontend.
//   5. Collect tool_use blocks, rehydrate their text payloads, resolve against
//      the user's real goals/programs, emit them in the SSE `done` event.
//   6. Async-ish (synchronous before `done`): update per-pseudonym summaries.
//
// Real names live only in our DB and the user's browser — Anthropic-compatible
// endpoints (Anthropic, DeepSeek) only ever see pseudonymized content.

const { Router } = require('express')
const { supabase } = require('../config')
const { verifyToken } = require('../middleware/auth')
const { dbGoalToShape, dbProgramToShape } = require('../lib/shapes')
const { resolveActions } = require('../lib/actionResolver')
const { buildGatewaySystem } = require('../prompts/lc-gateway')
const {
  redactFromHints, canonicalizeMappings, applyCanonicals,
  rehydrateText, rehydrateAction,
} = require('../lib/redactor')
const { claudeChatStream } = require('../lib/claude')
const {
  fetchPersonSummaries, extractPseudonymsFromText, buildReverseMappings,
  updateSummaries,
} = require('../lib/summaries')
const { LC_TOOLS } = require('../lib/tools')

const router = Router()

// Optional: prints per-turn redaction summary to the backend terminal so you
// can watch PII pseudonymization happen live during testing. Off by default.
const GATEWAY_DEBUG = process.env.LC_GATEWAY_DEBUG === 'true'

// POST /api/elsie/chat — streaming LC chat (route path kept for backwards compat)
router.post('/chat', verifyToken, async (req, res) => {
  try {
    const { messages = [], firstName = '', conversationId = null } = req.body || {}

    // Load context: active goals, programs, last reflection. Used both to build
    // the system prompt AND to resolve fuzzy goalRef/programRef → real UUIDs.
    const [goalsResult, programsResult, reflectionsResult] = await Promise.all([
      supabase.from('goals').select('*').eq('user_id', req.userId)
        .eq('status', 'active').order('created_at', { ascending: true }),
      supabase.from('programs').select('*').eq('user_id', req.userId)
        .in('status', ['active', 'completed']).order('updated_at', { ascending: false }),
      supabase.from('reflections').select('month,evaluation,suggestions,created_at')
        .eq('user_id', req.userId).order('created_at', { ascending: false }).limit(1),
    ])

    const goals    = (goalsResult.data    || []).map(dbGoalToShape)
    const programs = (programsResult.data || []).map(dbProgramToShape)
    const lastReflection = reflectionsResult.data?.[0] || null

    const nameStr = firstName || 'there'
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

    const now = new Date()
    const todayCtx = `Today is ${now.toLocaleDateString('en-US', { weekday: 'long' })}, ${now.toISOString().slice(0, 10)}.`

    const chatMessages = messages.length === 0
      ? [{ role: 'user', content: 'Please start this new chat with a short friendly greeting and ask what I would like help with.' }]
      : messages

    // ── SSE streaming setup ────────────────────────────────────────────────
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    try {
      await handleTurn({
        res, userId: req.userId, conversationId, chatMessages,
        // Skip-list: the user's own first name (not PII to themselves; Claude
        // already knows it) AND "LC" (the assistant's name, which appears in
        // greetings and gets mistakenly tagged as ORG/PERSON by BERT).
        skipNames: ['LC', nameStr].filter(n => n && n !== 'there'),
        goals, programs,
        systemArgs: { nameStr, goalsCtx, programsCtx, reflectionCtx, todayCtx },
      })
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
      res.end()
    }
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message })
    else { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end() }
  }
})

// Preview endpoint — POST text + entity hints, see the redactor's output
// without calling Claude. Hints come from the frontend NER; this just exercises
// the pseudonym minting + string-slicing path. Useful for testing edge cases.
router.post('/preview-redaction', verifyToken, async (req, res) => {
  try {
    const { text = '', entityHints = [] } = req.body || {}
    const result = redactFromHints(String(text), entityHints)
    res.json(result)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Global wipe — drops every pseudonym registry row for this user. Cascades to
// summaries and junction rows. Used by the "Clear LC memory" settings button.
router.post('/clear-pseudonyms', verifyToken, async (req, res) => {
  try {
    const { error, count } = await supabase
      .from('pseudonym_registry')
      .delete({ count: 'exact' })
      .eq('user_id', req.userId)
    if (error) throw error
    res.json({ deleted: count ?? 0 })
  } catch (err) { res.status(500).json({ error: err.message }) }
})


// ── Turn handler ─────────────────────────────────────────────────────────────
async function handleTurn({ res, userId, conversationId, chatMessages, skipNames, goals, programs, systemArgs }) {
  const HOLD_BACK = 32   // > longest possible pseudonym; prevents mid-pseudonym stream splits

  // 1. Redact every message using entity hints supplied by the frontend NER.
  // Both user and prior-assistant messages get hints — assistant turns were
  // rehydrated to real names before display, so they contain PII on the way
  // back. Frontend re-runs NER on the assistant message after streaming
  // completes and stores the hints on the message object.
  //
  // If a message arrives without hints (legacy conversation predating this
  // refactor, or a buggy client), we treat it as having no PII rather than
  // loading a server-side model. The skipNames pass still happens. This is
  // a fail-open posture for the legacy case; the cybersec test corpus
  // confirms the frontend NER stays in lockstep with what was previously
  // server-side.
  const perMessage = chatMessages.map(m =>
    ({ role: m.role,
       ...redactFromHints(m.content || '', m.entityHints || [], { skipNames }) })
  )

  // 2. Canonicalize all pseudonyms via the per-user registry (persistent IDs).
  const allMappings = perMessage.flatMap(p => p.mappings)
  const { canonicalsByKey, registryIdsByKey } = await canonicalizeMappings(userId, allMappings)

  // Junction: link this turn's NEW pseudonyms to the conversation for GC.
  const latestMappings = perMessage[perMessage.length - 1]?.mappings || []
  const latestRegistryIds = new Set()
  for (const m of latestMappings) {
    const id = registryIdsByKey.get(`${m.type}:${m.real.toLowerCase()}`)
    if (id) latestRegistryIds.add(id)
  }
  if (conversationId && latestRegistryIds.size > 0) {
    const rows = [...latestRegistryIds].map(id => ({
      conversation_id: conversationId, pseudonym_registry_id: id,
    }))
    const { error } = await supabase
      .from('lc_conversation_pseudonyms')
      .upsert(rows, { onConflict: 'conversation_id,pseudonym_registry_id', ignoreDuplicates: true })
    if (error) console.warn('[gateway] junction insert failed (non-fatal):', error.message)
  }

  // 3. Apply canonicals to each message → array sent to the model.
  const claudeMessages = perMessage.map(p => ({
    role:    p.role,
    content: applyCanonicals(p.redactedText, p.mappings, canonicalsByKey),
  }))

  // 4. Fetch long-term notes for every entity in the conversation. Lets the
  // model recognize people referred to by pronoun and pull cross-conversation
  // memory for anyone it's met before.
  const allRegistryIds = new Set(registryIdsByKey.values())
  const personSummaries = await fetchPersonSummaries(userId, [...allRegistryIds])

  // 5. Build rehydration mappings — union of history pseudonyms and any
  // pseudonyms referenced inside summaries (since the model may cite them
  // in its response).
  const pseudonymsInSummaries = new Set(
    [...personSummaries.values()].flatMap(s => extractPseudonymsFromText(s))
  )
  const historyPseudonyms = new Set([...canonicalsByKey.values()].filter(Boolean))
  const summaryOnly = [...pseudonymsInSummaries].filter(p => !historyPseudonyms.has(p))
  const summaryReverse = await buildReverseMappings(userId, summaryOnly)

  const rehydrationMappings = [
    ...[...new Set(allMappings.map(m => `${m.type}:${m.real.toLowerCase()}`))].map(key => {
      const m = allMappings.find(lm => `${lm.type}:${lm.real.toLowerCase()}` === key)
      return { pseudonym: canonicalsByKey.get(key), real: m?.real || '' }
    }).filter(m => m.pseudonym && m.real),
    ...summaryReverse.map(s => ({ pseudonym: s.pseudonym, real: s.real })),
  ]

  // 6. Build the person-summaries block — every entity in conversation history.
  const personBlock = [...allMappings].reduce((acc, m) => {
    const key = `${m.type}:${m.real.toLowerCase()}`
    if (acc.seen.has(key)) return acc
    acc.seen.add(key)
    const pseudonym = canonicalsByKey.get(key)
    const regId     = registryIdsByKey.get(key)
    const summary   = personSummaries.get(regId) || '(no prior notes — first mention)'
    if (pseudonym) acc.lines.push(`  - ${pseudonym}: ${summary}`)
    return acc
  }, { seen: new Set(), lines: [] }).lines.join('\n')

  if (GATEWAY_DEBUG) {
    const fmt = m => `${m.real}(${m.type})→${canonicalsByKey.get(`${m.type}:${m.real.toLowerCase()}`)}`
    const dedupe = arr => [...new Map(arr.map(m => [`${m.type}:${m.real.toLowerCase()}`, m])).values()]
    const histPII = dedupe(perMessage.slice(0, -1).flatMap(p => p.mappings))
      .filter(h => !dedupe(latestMappings).some(n => `${n.type}:${n.real.toLowerCase()}` === `${h.type}:${h.real.toLowerCase()}`))
    const last         = chatMessages[chatMessages.length - 1]
    const lastRedacted = claudeMessages[claudeMessages.length - 1]
    console.log('\n┌── LC gateway turn ─────────────────────────────────────')
    console.log(`│ USER:        ${last?.content || ''}`)
    console.log(`│ TO CLAUDE:   ${lastRedacted?.content || ''}`)
    console.log(`│ NEW PII:     ${latestMappings.length ? dedupe(latestMappings).map(fmt).join(', ') : '(none)'}`)
    console.log(`│ FROM HIST:   ${histPII.length ? histPII.map(fmt).join(', ') : '(none)'}`)
    console.log(`│ PERSON SUMS: ${personSummaries.size} loaded for ${allRegistryIds.size} entities`)
    console.log('└────────────────────────────────────────────────────────')
  }

  // 7. Build system prompt + stream the response.
  const system = buildGatewaySystem({ ...systemArgs, personSummariesBlock: personBlock })

  let buffer = ''
  let flushedUpTo = 0
  let fullPseudoText = ''
  let rawTools = []

  for await (const event of claudeChatStream({ system, messages: claudeMessages, tools: LC_TOOLS })) {
    if (event.type === 'text') {
      buffer += event.text
      fullPseudoText += event.text
      const safeEnd = Math.max(flushedUpTo, buffer.length - HOLD_BACK)
      if (safeEnd > flushedUpTo) {
        const slice = buffer.slice(flushedUpTo, safeEnd)
        res.write(`data: ${JSON.stringify({ delta: rehydrateText(slice, rehydrationMappings) })}\n\n`)
        flushedUpTo = safeEnd
      }
    } else if (event.type === 'tools') {
      rawTools = event.tools
    }
  }
  // Flush the held tail.
  const tail = buffer.slice(flushedUpTo)
  if (tail) res.write(`data: ${JSON.stringify({ delta: rehydrateText(tail, rehydrationMappings) })}\n\n`)

  // 8. Convert tool_use blocks into actions, rehydrate text fields, resolve
  // refs to real UUIDs against the user's goals/programs.
  const pseudonymizedActions = rawTools.map(t => ({ type: t.name, ...(t.input || {}) }))
  const actionsWithRealNames = pseudonymizedActions.map(a => rehydrateAction(a, rehydrationMappings))
  const { actions, dropped } = resolveActions(actionsWithRealNames, goals, programs)

  // 9. Update per-pseudonym summaries for every entity in the conversation
  // (sync before `done` so the next turn sees fresh notes).
  const pseudonymToRegistryId = new Map()
  for (const [key, regId] of registryIdsByKey) {
    const pseudonym = canonicalsByKey.get(key)
    if (pseudonym) pseudonymToRegistryId.set(pseudonym, regId)
  }
  try {
    await updateSummaries({
      userId, conversationId: null,
      pseudonymToRegistryId,
      priorPersonSummaries:     personSummaries,
      priorConversationSummary: null,
      pseudonymizedUserMsg:     claudeMessages[claudeMessages.length - 1]?.content || '',
      pseudonymizedAssistantMsg: fullPseudoText,
    })
  } catch (e) {
    console.warn('[gateway] summary update failed (non-fatal):', e.message)
  }

  // 10. Done event with the full rehydrated message + resolved actions.
  const fullMessage = rehydrateText(fullPseudoText, rehydrationMappings)
  res.write(`data: ${JSON.stringify({
    done:    true,
    message: fullMessage,
    actions,
    dropped,
  })}\n\n`)
  res.end()
}

module.exports = router
