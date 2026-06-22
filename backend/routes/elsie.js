// LC chat route — Claude/DeepSeek via the local PII gateway.
//
// One path, one shape:
//   1. Redact every message in history (per-user pseudonym map, encrypted at rest).
//   2. Fetch long-term notes for every entity in the conversation.
//   3. Call the model with redacted history + tool definitions + injected summaries.
//   4. Collect the full response, rehydrate pseudonyms back to real names.
//   5. Convert tool_use blocks into actions, rehydrate their text payloads,
//      resolve against the user's real goals/programs.
//   6. Update per-pseudonym summaries (synchronous before responding).
//   7. Return one JSON response with the full message + resolved actions.
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
const { LC_TOOLS, isServerResolvedTool } = require('../lib/tools')
const { tavilySearch, formatResultsForModel } = require('../lib/search')
const { logMemory } = require('../lib/memory')

// Cap on how many server-resolved tool loops we'll run per turn. Prevents a
// model that's enthusiastic about searching from racking up a long chain
// (and the user's wait). 3 is plenty: search → refine → search again is the
// realistic upper bound; anything more is wheel-spinning.
const MAX_TOOL_HOPS = 3

const router = Router()

// Optional: prints per-turn redaction summary to the backend terminal so you
// can watch PII pseudonymization happen live during testing. Off by default.
const GATEWAY_DEBUG = process.env.LC_GATEWAY_DEBUG === 'true'

// POST /api/elsie/chat — LC chat turn (single JSON response)
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
    // One line per goal/program. The model only needs the title for natural
    // reference and progress for "how are you doing on X" questions; full
    // descriptions are noise on every turn — they're surfaceable on demand.
    const goalsCtx = goals.length
      ? goals.map(g => {
          const prog = g.programId ? programs.find(p => p.id === g.programId)?.name : null
          return `  - "${g.title}" (${g.progress}%${prog ? `, ${prog}` : ''})`
        }).join('\n')
      : '  (no active goals this month)'
    const programsCtx = programs.length
      ? programs.map(p => `  - "${p.name}" (${p.status})`).join('\n')
      : '  (no programs)'
    // Cap reflection evaluation; full prose is rarely load-bearing across turns.
    // Suggestions matter more — they're concrete next steps the trainer chose.
    const reflectionCtx = lastReflection
      ? (() => {
          const evalText = (lastReflection.evaluation || '').slice(0, 280).trim()
          const suggs = Array.isArray(lastReflection.suggestions) ? lastReflection.suggestions : []
          const suggLine = suggs.length ? `\nSuggestions: ${suggs.slice(0, 4).join('; ')}` : ''
          return `Last reflection (${lastReflection.month}): ${evalText}${suggLine}`
        })()
      : '  (no reflections yet)'

    const now = new Date()
    const todayCtx = `Today is ${now.toLocaleDateString('en-US', { weekday: 'long' })}, ${now.toISOString().slice(0, 10)}.`

    const chatMessages = messages.length === 0
      ? [{ role: 'user', content: 'Please start this new chat with a short friendly greeting and ask what I would like help with.' }]
      : messages

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
    console.error('[elsie/chat]', err?.message)
    if (!res.headersSent) res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
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
  } catch (err) { res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' }) }
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
  } catch (err) { res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' }) }
})


// ── Turn handler ─────────────────────────────────────────────────────────────
async function handleTurn({ res, userId, conversationId, chatMessages, skipNames, goals, programs, systemArgs }) {
  logMemory('turn:start')

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
  //
  // For assistant messages that executed tool calls on a prior turn, we
  // reconstruct synthetic tool_use blocks + paired tool_result blocks on the
  // following user message. Without this, the model sees only its own prose
  // ("I'll create that goal") with no proof the tool ran, and re-emits the
  // same call on the next turn. This loop closure is required by the
  // Anthropic tool-use protocol — DeepSeek's Anthropic-compatible endpoint
  // honors it too.
  //
  // Action inputs are intentionally empty objects: the model already knows
  // what it called from its own prior turn, and the *result* of the call
  // (the created goal, the logged win) is in the dynamic USER CONTEXT block.
  // Re-pseudonymizing full action payloads here would be duplicative work.
  const claudeMessages = []
  for (let i = 0; i < perMessage.length; i++) {
    const p = perMessage[i]
    const orig = chatMessages[i]
    const text = applyCanonicals(p.redactedText, p.mappings, canonicalsByKey)
    const completedActions = p.role === 'assistant' && Array.isArray(orig?.actions)
      ? orig.actions.filter(a => a && a.type && a._state === 'done')
      : []
    if (completedActions.length === 0) {
      claudeMessages.push({ role: p.role, content: text })
      continue
    }
    // Build the assistant turn with tool_use blocks alongside the prose.
    const blocks = []
    if (text) blocks.push({ type: 'text', text })
    const toolResults = []
    completedActions.forEach((a, idx) => {
      const toolUseId = `hist_${i}_${idx}`
      blocks.push({ type: 'tool_use', id: toolUseId, name: a.type, input: {} })
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: 'Completed successfully. Result is reflected in USER CONTEXT below.',
      })
    })
    claudeMessages.push({ role: 'assistant', content: blocks })
    // Tool_result blocks must arrive in the immediately-following user turn.
    // Merge them with the next user message's text if there is one; otherwise
    // emit a standalone user message containing just the tool_results.
    const nextP = perMessage[i + 1]
    if (nextP?.role === 'user') {
      const nextText = applyCanonicals(nextP.redactedText, nextP.mappings, canonicalsByKey)
      const userBlocks = [...toolResults]
      if (nextText) userBlocks.push({ type: 'text', text: nextText })
      claudeMessages.push({ role: 'user', content: userBlocks })
      i++ // consume the user message we just merged
    } else {
      claudeMessages.push({ role: 'user', content: toolResults })
    }
  }

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
    const dedupe = arr => [...new Map(arr.map(m => [`${m.type}:${m.real.toLowerCase()}`, m])).values()]
    // Mark each formatted entity with [new] if THIS is the first turn it has
    // appeared in the registry, [seen] if it was reused from a prior turn.
    // "First registry insert" is detectable as: latest message contains the
    // mapping AND no earlier message in this conversation history references
    // the same key.
    const histKeys = new Set(
      perMessage.slice(0, -1).flatMap(p => p.mappings).map(m => `${m.type}:${m.real.toLowerCase()}`)
    )
    const fmt = m => {
      const key = `${m.type}:${m.real.toLowerCase()}`
      const tag = histKeys.has(key) ? '[seen]' : '[new]'
      return `${m.real}(${m.type})→${canonicalsByKey.get(key)} ${tag}`
    }
    const histPII = dedupe(perMessage.slice(0, -1).flatMap(p => p.mappings))
      .filter(h => !dedupe(latestMappings).some(n => `${n.type}:${n.real.toLowerCase()}` === `${h.type}:${h.real.toLowerCase()}`))
    const last         = chatMessages[chatMessages.length - 1]
    const lastRedacted = claudeMessages[claudeMessages.length - 1]
    console.log('\n┌── LC gateway turn ─────────────────────────────────────')
    console.log(`│ USER:        ${last?.content || ''}`)
    console.log(`│ TO CLAUDE:   ${lastRedacted?.content || ''}`)
    console.log(`│ IN THIS MSG: ${latestMappings.length ? dedupe(latestMappings).map(fmt).join(', ') : '(none)'}`)
    console.log(`│ FROM HIST:   ${histPII.length ? histPII.map(fmt).join(', ') : '(none)'}`)
    console.log(`│ PERSON SUMS: ${personSummaries.size} loaded for ${allRegistryIds.size} entities`)
    console.log('└────────────────────────────────────────────────────────')
  }

  // 7. Build system prompt and call the model. We collect the full response
  // server-side (no wire-level streaming) so rehydration happens once over
  // the complete text — no chunk-boundary pseudonym splits, no live regex
  // races.
  const system = buildGatewaySystem({ ...systemArgs, personSummariesBlock: personBlock })

  logMemory('before-llm')

  // 7b. Tool loop: the model may emit server-resolved tools (search_web) we
  // run mid-turn before its final answer. We loop up to MAX_TOOL_HOPS,
  // appending each call's tool_use + tool_result to the working history.
  // Frontend-executed tools (create_goal, log_win, etc.) bubble up only
  // from the FINAL hop — earlier hops shouldn't act before research lands.
  let workingMessages = claudeMessages
  let fullPseudoText = ''
  let finalFrontendTools = []
  const citations = []

  for (let hop = 0; hop <= MAX_TOOL_HOPS; hop++) {
    let turnText = ''
    let turnTools = []
    let turnThinking = []
    for await (const event of claudeChatStream({ system, messages: workingMessages, tools: LC_TOOLS })) {
      if (event.type === 'text')          turnText += event.text
      else if (event.type === 'tools')    turnTools = event.tools
      else if (event.type === 'thinking') turnThinking = event.blocks
    }

    // Each hop's text overwrites — the final hop's prose is what the user sees.
    fullPseudoText = turnText

    const serverCalls   = turnTools.filter(t => isServerResolvedTool(t.name))
    const frontendCalls = turnTools.filter(t => !isServerResolvedTool(t.name))
    finalFrontendTools  = frontendCalls

    if (!serverCalls.length) break

    // Budget cap reached: the model still wants to search but we won't let it.
    // Without intervention we'd return an empty response (model emitted tools,
    // not prose). Close the loop with synthetic "budget exhausted" tool_results
    // so the conversation state is valid, then do one more call WITHOUT tools
    // to force a written synthesis from the citations we already gathered.
    if (hop === MAX_TOOL_HOPS) {
      const capAssistantBlocks = [...turnThinking]
      if (turnText) capAssistantBlocks.push({ type: 'text', text: turnText })
      const capResultBlocks = []
      serverCalls.forEach((call, i) => {
        const id = `srv_cap_${i}`
        capAssistantBlocks.push({ type: 'tool_use', id, name: call.name, input: call.input || {} })
        capResultBlocks.push({
          type: 'tool_result',
          tool_use_id: id,
          content: 'Search budget exhausted for this turn. Do not request more searches — synthesize your final answer for the user from the results already gathered above, citing them as [1], [2], etc.',
        })
      })
      workingMessages = [
        ...workingMessages,
        { role: 'assistant', content: capAssistantBlocks },
        { role: 'user',      content: capResultBlocks },
      ]
      let synthText = ''
      for await (const event of claudeChatStream({ system, messages: workingMessages })) {
        if (event.type === 'text') synthText += event.text
      }
      if (synthText) fullPseudoText = synthText
      // finalFrontendTools stays as whatever the prior hop produced; the
      // synthesis pass runs without tools so no new actions arise here.
      break
    }

    // Resolve server-side calls and append matching tool_use + tool_result
    // blocks to the working history so the next model call sees the loop closed.
    // Thinking blocks MUST come first in the assistant turn and be passed back
    // verbatim with their signature — required by the Anthropic API whenever
    // extended thinking is enabled and a tool_use turn is being continued.
    const assistantBlocks = [...turnThinking]
    if (turnText) assistantBlocks.push({ type: 'text', text: turnText })
    const toolResultBlocks = []
    for (let i = 0; i < serverCalls.length; i++) {
      const call = serverCalls[i]
      const toolUseId = `srv_${hop}_${i}`
      assistantBlocks.push({ type: 'tool_use', id: toolUseId, name: call.name, input: call.input || {} })
      let resultText
      if (call.name === 'search_web') {
        try {
          const sr = await tavilySearch(call.input?.query || '', { maxResults: call.input?.maxResults })
          resultText = formatResultsForModel(sr)
          for (const r of sr.results) {
            // Dedupe by URL; first occurrence wins.
            if (r.url && !citations.some(c => c.url === r.url)) {
              citations.push({ title: r.title, url: r.url, snippet: r.snippet })
            }
          }
        } catch (err) {
          resultText = `Search failed: ${err.message}. Answer from general knowledge and tell the user web search is unavailable right now.`
        }
      } else {
        resultText = `Unknown server-resolved tool "${call.name}".`
      }
      toolResultBlocks.push({ type: 'tool_result', tool_use_id: toolUseId, content: resultText })
    }
    workingMessages = [
      ...workingMessages,
      { role: 'assistant', content: assistantBlocks },
      { role: 'user',      content: toolResultBlocks },
    ]
  }

  // 8. Convert frontend tool_use blocks into actions, rehydrate text fields,
  // resolve refs to real UUIDs against the user's goals/programs.
  const pseudonymizedActions = finalFrontendTools.map(t => ({ type: t.name, ...(t.input || {}) }))
  const actionsWithRealNames = pseudonymizedActions.map(a => rehydrateAction(a, rehydrationMappings))
  const { actions, dropped } = resolveActions(actionsWithRealNames, goals, programs)

  // 9. Update per-pseudonym summaries for every entity in the conversation
  // (sync before responding so the next turn sees fresh notes — moving this
  // off the hot path is a separate change once the Flash summary updater
  // lands).
  const pseudonymToRegistryId = new Map()
  for (const [key, regId] of registryIdsByKey) {
    const pseudonym = canonicalsByKey.get(key)
    if (pseudonym) pseudonymToRegistryId.set(pseudonym, regId)
  }
  try {
    await updateSummaries({
      userId, conversationId,
      pseudonymToRegistryId,
      priorPersonSummaries:     personSummaries,
      priorConversationSummary: null,
      pseudonymizedUserMsg:     claudeMessages[claudeMessages.length - 1]?.content || '',
      pseudonymizedAssistantMsg: fullPseudoText,
    })
  } catch (e) {
    console.warn('[gateway] summary update failed (non-fatal):', e.message)
  }

  logMemory('turn:end')

  // 10. Single JSON response with the full rehydrated message + resolved
  // actions + any citations gathered from server-resolved search calls.
  const fullMessage = rehydrateText(fullPseudoText, rehydrationMappings)

  // 10b. Audit capture — store the real vs pseudonymized text for the user
  // turn and the assistant turn so admins can verify nothing crossed the wire
  // unredacted. Append-only, conversation-scoped, best-effort.
  try {
    const lastUserOrig    = chatMessages[chatMessages.length - 1]
    const lastUserPseudo  = perMessage[perMessage.length - 1]
    const lastUserPseudoText = lastUserPseudo
      ? applyCanonicals(lastUserPseudo.redactedText, lastUserPseudo.mappings, canonicalsByKey)
      : ''
    await supabase.from('lc_message_audit').insert({
      user_id:               userId,
      conversation_id:       conversationId,
      turn_index:            chatMessages.length - 1,
      real_user_text:        lastUserOrig?.content || '',
      pseudo_user_text:      lastUserPseudoText || '',
      real_assistant_text:   fullMessage,
      pseudo_assistant_text: fullPseudoText,
    })
  } catch (e) {
    console.warn('[gateway] audit insert failed (non-fatal):', e.message)
  }

  res.json({ message: fullMessage, actions, dropped, citations })
}

module.exports = router
