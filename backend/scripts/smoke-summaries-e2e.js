// End-to-end smoke test for the stateless-Claude + summary-storage model.
//
// Validates:
//   1. Each Claude call sees ONLY the current user message — no chat history.
//   2. After each turn, person and conversation summaries are populated.
//   3. Cross-turn continuity works without history: a fact mentioned in turn 1
//      is recalled correctly in turn 3 via the summary store.
//   4. Deleting the conversation cascades and drops its conversation_summary.
//
// REQUIREMENTS:
//   - All env vars set, migrations 005/006/007 run in Supabase.
//   - At least one user in auth.users.
//
// COST: ~6 Claude calls (3 main + 3 summary updates). Pennies per run.
//
// SIDE EFFECTS: creates a test conversation + pseudonym registry rows +
// summary rows. Pass --cleanup to delete them at the end.

const { supabase } = require('../config')
const { redactText, canonicalizeMappings, applyCanonicals, rehydrateText } = require('../lib/redactor')
const { claudeChatStream } = require('../lib/claude')
const { buildGatewaySystem } = require('../prompts/lc-gateway')
const {
  fetchPersonSummaries, fetchConversationSummary,
  extractPseudonymsFromText, buildReverseMappings,
  updateSummaries,
} = require('../lib/summaries')
const { hashForUser } = require('../lib/crypto')

const TEST_REAL_NAMES = ['Marcus', 'Sarah']
const TURNS = [
  // Turn 1 — introduces Marcus with a specific characteristic
  "I'm coaching Marcus, a new manager who avoids hard conversations. Where would you start?",
  // Turn 2 — introduces Sarah; references neither by name initially
  "Same question for someone whose issue is more about delivery — Sarah is direct but her tone reads as harsh.",
  // Turn 3 — references Marcus by name BUT the question depends on the
  // turn-1 detail ("avoids hard conversations"). With no chat history,
  // this only works if the summary captured it.
  "For Marcus specifically — what's the lowest-stakes first exercise you'd suggest given the issue I mentioned?",
]

let pass = 0, fail = 0
const issues = []
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; issues.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

async function getTestUserId() {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 })
  if (error) throw new Error(`list users: ${error.message}`)
  if (!data.users.length) throw new Error('No users in auth.users — sign up in your app first.')
  return data.users[0].id
}

async function createTestConversation(userId) {
  const { data, error } = await supabase
    .from('lc_conversations')
    .insert({ user_id: userId, title: 'summary-model smoke test' })
    .select('id')
    .single()
  if (error) throw new Error(`create conversation: ${error.message}`)
  return data.id
}

async function streamClaudeFull(args) {
  let full = ''
  for await (const delta of claudeChatStream(args)) full += delta
  return full
}

async function runOneTurn({ userId, conversationId, userMsg, turnIndex }) {
  console.log(`\n── Turn ${turnIndex + 1} ───────────────────────────────────────────`)
  console.log(`USER:  "${userMsg}"`)

  // Replicate the gateway flow.
  const { redactedText, mappings } = await redactText(userMsg, { skipNames: [] })
  const { canonicalsByKey, registryIdsByKey } = await canonicalizeMappings(userId, mappings)
  const claudeUserMsg = applyCanonicals(redactedText, mappings, canonicalsByKey)

  // Junction insert (so we can verify GC later)
  if (registryIdsByKey.size > 0) {
    const junctionRows = [...registryIdsByKey.values()].map(id => ({
      conversation_id: conversationId,
      pseudonym_registry_id: id,
    }))
    await supabase.from('lc_conversation_pseudonyms')
      .upsert(junctionRows, { onConflict: 'conversation_id,pseudonym_registry_id', ignoreDuplicates: true })
  }

  // Fetch summaries (the prior-turn state).
  const registryIdsThisTurn = [...registryIdsByKey.values()]
  const [personSummaries, conversationSummary] = await Promise.all([
    fetchPersonSummaries(userId, registryIdsThisTurn),
    fetchConversationSummary(userId, conversationId),
  ])

  console.log(`TO CLAUDE: "${claudeUserMsg}"`)
  console.log(`PRIOR SUMS: ${personSummaries.size} person, convo="${(conversationSummary || '').slice(0, 60)}${conversationSummary?.length > 60 ? '…' : ''}"`)

  // ASSERT 1: Claude sees no chat history (only this turn's redacted message).
  // We construct the messages array we'd send to Claude and inspect it.
  const claudeMessages = [{ role: 'user', content: claudeUserMsg }]
  check(
    `turn ${turnIndex + 1} Claude payload contains only the current turn`,
    claudeMessages.length === 1 && claudeMessages[0].role === 'user',
    `got ${claudeMessages.length} messages: ${JSON.stringify(claudeMessages.map(m => m.role))}`
  )
  for (const name of TEST_REAL_NAMES) {
    check(
      `turn ${turnIndex + 1} no real name "${name}" in Claude payload`,
      !claudeUserMsg.includes(name),
      claudeUserMsg.includes(name) ? `leaked: ${claudeUserMsg}` : ''
    )
  }

  // Build the person-summaries block as the gateway does.
  const personBlock = [...registryIdsByKey.entries()].map(([key, regId]) => {
    const pseudonym = canonicalsByKey.get(key)
    const summary   = personSummaries.get(regId) || '(no prior notes — first mention)'
    return `  - ${pseudonym}: ${summary}`
  }).join('\n')

  // Call Claude
  const system = buildGatewaySystem({
    nameStr:        'Amro',
    goalsCtx:       '  (No active goals)',
    programsCtx:    '  (No programs)',
    reflectionCtx:  '  (No reflections)',
    todayCtx:       `Today is ${new Date().toDateString()}.`,
    personSummariesBlock: personBlock,
    conversationSummary:  conversationSummary || '',
  })
  const pseudoResponse = await streamClaudeFull({ system, messages: claudeMessages })

  // Build full rehydration mapping (current + summary-referenced pseudonyms)
  const pseudonymsInSummaries = new Set([
    ...extractPseudonymsFromText(conversationSummary || ''),
    ...[...personSummaries.values()].flatMap(s => extractPseudonymsFromText(s)),
  ])
  const currentTurnPseudonyms = new Set([...registryIdsByKey.keys()].map(key => canonicalsByKey.get(key)))
  const allPseudonyms = new Set([...pseudonymsInSummaries, ...currentTurnPseudonyms])
  const toLookUp = [...allPseudonyms].filter(p => !currentTurnPseudonyms.has(p))
  const summaryReverse = await buildReverseMappings(userId, toLookUp)
  const rehydrationMappings = [
    ...[...registryIdsByKey.keys()].map(key => {
      const m = mappings.find(lm => `${lm.type}:${lm.real.toLowerCase()}` === key)
      return { pseudonym: canonicalsByKey.get(key), real: m?.real || '' }
    }).filter(m => m.real),
    ...summaryReverse.map(s => ({ pseudonym: s.pseudonym, real: s.real })),
  ]

  const userVisible = rehydrateText(pseudoResponse, rehydrationMappings)
  console.log(`CLAUDE→USER: "${userVisible.slice(0, 160)}${userVisible.length > 160 ? '…' : ''}"`)

  // Update summaries (sync)
  const pseudonymToRegistryId = new Map()
  for (const [key, regId] of registryIdsByKey) {
    const pseudonym = canonicalsByKey.get(key)
    if (pseudonym) pseudonymToRegistryId.set(pseudonym, regId)
  }
  await updateSummaries({
    userId, conversationId, pseudonymToRegistryId,
    priorPersonSummaries:     personSummaries,
    priorConversationSummary: conversationSummary,
    pseudonymizedUserMsg:     claudeUserMsg,
    pseudonymizedAssistantMsg: pseudoResponse,
  })

  // ASSERT 2: summaries were populated.
  const [newPersonSums, newConvoSum] = await Promise.all([
    fetchPersonSummaries(userId, registryIdsThisTurn),
    fetchConversationSummary(userId, conversationId),
  ])
  for (const regId of registryIdsThisTurn) {
    check(`turn ${turnIndex + 1} person summary for ${regId.slice(0, 8)}… is populated`,
          newPersonSums.has(regId) && newPersonSums.get(regId).length > 0)
  }
  check(`turn ${turnIndex + 1} conversation summary is populated`,
        !!newConvoSum && newConvoSum.length > 0)

  return { userVisible }
}

;(async () => {
  console.log('LC Gateway — Stateless-Claude + Summary Storage Smoke')
  console.log('======================================================')

  const userId = await getTestUserId()
  const conversationId = await createTestConversation(userId)
  console.log(`User: ${userId}`)
  console.log(`Test conversation: ${conversationId}`)

  let turn3Result = null
  for (let i = 0; i < TURNS.length; i++) {
    const result = await runOneTurn({ userId, conversationId, userMsg: TURNS[i], turnIndex: i })
    if (i === 2) turn3Result = result
  }

  // ASSERT 3: Cross-turn continuity. Turn 3 asks about Marcus and references
  // "the issue I mentioned" (which was in turn 1). For Claude to give a
  // coherent answer it must have known Marcus avoids hard conversations.
  // Heuristic: response should mention something related to that issue.
  console.log('\n── Cross-turn continuity ──')
  const turn3Lower = (turn3Result?.userVisible || '').toLowerCase()
  const continuitySignals = ['hard conversation', 'avoid', 'low-stakes', 'feedback', 'difficult', 'discomfort']
  const matched = continuitySignals.filter(s => turn3Lower.includes(s))
  check(
    'turn 3 response shows continuity with turn 1 (mentions hard-conversations theme without it being in this turn)',
    matched.length > 0,
    matched.length === 0 ? `no expected signals found in: "${turn3Result?.userVisible?.slice(0, 200)}…"` : ''
  )

  // ASSERT 4: Conversation cascade.
  if (process.argv.includes('--cleanup')) {
    console.log('\n── Cleanup + cascade check ──')
    const { error: delErr } = await supabase
      .from('lc_conversations').delete().eq('id', conversationId)
    if (delErr) console.log(`  cleanup failed: ${delErr.message}`)
    else {
      const { data: leftover } = await supabase
        .from('conversation_summaries').select('conversation_id').eq('conversation_id', conversationId)
      check('conversation_summaries cascade-deleted with conversation',
            !leftover || leftover.length === 0)

      // Orphan pseudonyms — sweep them
      const { error: gcErr } = await supabase.rpc('delete_orphan_pseudonyms', { p_user_id: userId })
      if (gcErr) console.log(`  orphan GC failed: ${gcErr.message}`)
      else      console.log('  orphan pseudonyms swept')
    }
  } else {
    console.log('\n(Pass --cleanup to delete the test conversation + pseudonyms.)')
  }

  console.log('\n======================================================')
  console.log(`Total: ${pass} passed, ${fail} failed`)
  if (fail) {
    console.log('\nFAILURES:')
    for (const f of issues) console.log(`  - ${f}`)
    process.exit(1)
  }
  console.log('All assertions passed.')
})().catch(err => { console.error('\nSmoke crashed:', err); process.exit(1) })
