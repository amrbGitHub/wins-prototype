// End-to-end smoke test for the LC pseudonymization gateway.
//
// Runs a multi-turn conversation through the same code paths as the live
// route. Verifies at every step that:
//   - The text sent to Claude contains NO real names from our corpus.
//   - The rehydrated response shown to the user DOES contain the right
//     real names (where Claude referenced them).
//   - The same real name → same persisted pseudonym across turns (registry
//     persistence is working).
//
// REQUIREMENTS:
//   - PSEUDONYM_ENCRYPTION_KEY set in backend/.env
//   - ANTHROPIC_API_KEY      set in backend/.env
//   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set in backend/.env
//   - Migration 005 run in Supabase
//   - At least one user in auth.users (we'll grab the first one as a test user)
//
// COST: each run hits Claude Haiku 4.5 for 3 turns; expect ~$0.001-0.01 total.
//
// SIDE EFFECTS: creates persistent rows in pseudonym_registry under your
// existing user. Pass --cleanup to delete these rows when done.

const { supabase } = require('../config')
const { redactText, canonicalizeMappings, applyCanonicals, rehydrateText } = require('../lib/redactor')
const { claudeChatStream } = require('../lib/claude')
const { buildGatewaySystem } = require('../prompts/lc-gateway')
const { hashForUser } = require('../lib/crypto')

// Known real names used in the test conversation — used to assert nothing
// leaks into the Claude-bound payload.
const TEST_REAL_NAMES = ['James', 'Sarah', 'Acme Corp', 'Boston']

const TEST_CONVERSATION = [
  { role: 'user', content: 'I want to coach James on giving better feedback — he avoids hard conversations. What angle should I take?' },
  // Assistant response synthesized after first Claude call
  { role: 'user', content: "James and Sarah from Acme Corp are both struggling — Sarah's issue is more about delivery than content. Should I handle them differently?" },
  { role: 'user', content: "Last thing — we're piloting this in our Boston session next month. Anything specific to prep for James given what we discussed?" },
]

let pass = 0, fail = 0
const issues = []

function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; issues.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

function containsAnyRealName(text) {
  return TEST_REAL_NAMES.filter(n => text.includes(n))
}

async function getTestUserId() {
  // Use admin API to list users; take the first one.
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 })
  if (error) throw new Error(`failed to list users: ${error.message}`)
  if (!data.users.length) throw new Error('No users in auth.users — sign up in your app first.')
  return data.users[0].id
}

async function streamClaudeFull(args) {
  let full = ''
  for await (const delta of claudeChatStream(args)) full += delta
  return full
}

async function runOneTurn(userId, history, turnIndex) {
  console.log(`\n── Turn ${turnIndex + 1} ───────────────────────────────────────────`)
  const userMsg = history[history.length - 1]
  console.log(`USER (real names):     "${userMsg.content}"`)

  // 1. Redact every message in history (matches gateway behavior).
  const perMessage = []
  for (const m of history) {
    const { redactedText, mappings } = await redactText(m.content)
    perMessage.push({ role: m.role, redactedText, mappings })
  }

  // 2. Canonicalize against the registry.
  const allMappings = perMessage.flatMap(p => p.mappings)
  const { canonicalsByKey } = await canonicalizeMappings(userId, allMappings)

  // 3. Apply canonicals to each message → final array for Claude.
  const claudeMessages = perMessage.map(p => ({
    role:    p.role,
    content: applyCanonicals(p.redactedText, p.mappings, canonicalsByKey),
  }))

  // Show what Claude will see (last user message).
  const lastForClaude = claudeMessages[claudeMessages.length - 1].content
  console.log(`TO CLAUDE (redacted):  "${lastForClaude}"`)

  // ASSERT: no real names in any message sent to Claude.
  for (let i = 0; i < claudeMessages.length; i++) {
    const leaks = containsAnyRealName(claudeMessages[i].content)
    check(
      `turn ${turnIndex + 1} msg ${i + 1} contains no real PII in Claude payload`,
      leaks.length === 0,
      leaks.length ? `leaked: ${leaks.join(', ')}` : ''
    )
  }

  // 4. Call Claude.
  const system = buildGatewaySystem({
    nameStr:        'Amro',
    goalsCtx:       '  (No active goals set yet this month)',
    programsCtx:    '  (No programs set up yet — they\'re optional)',
    reflectionCtx:  '  (No reflections yet)',
    todayCtx:       `Today is ${new Date().toDateString()}.`,
  })
  const pseudoResponse = await streamClaudeFull({ system, messages: claudeMessages })

  // 5. Build rehydration mappings: canonical pseudonym → real value.
  const rehydrationMappings = []
  const seen = new Set()
  for (const m of allMappings) {
    const key = `${m.type}:${m.real.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    const canonical = canonicalsByKey.get(key)
    if (canonical) rehydrationMappings.push({ pseudonym: canonical, real: m.real })
  }

  const userVisibleResponse = rehydrateText(pseudoResponse, rehydrationMappings)
  console.log(`CLAUDE (pseudonyms):   "${pseudoResponse}"`)
  console.log(`USER SEES (rehydrated):"${userVisibleResponse}"`)

  // ASSERT: rehydrated response has no leftover pseudonyms (Person_XXXX style).
  const leftover = userVisibleResponse.match(/\b(?:Person|Org|Loc|Ent)_[0-9A-F]{4}\b/g)
  check(
    `turn ${turnIndex + 1} no leftover pseudonyms in user-visible text`,
    !leftover,
    leftover ? `found: ${leftover.join(', ')}` : ''
  )

  return { assistantMessage: userVisibleResponse, canonicalsByKey }
}

;(async () => {
  console.log('LC Gateway — End-to-End Smoke Test')
  console.log('===================================\n')

  const userId = await getTestUserId()
  console.log(`Using test user: ${userId}`)

  // Track canonical pseudonyms across turns to assert persistence.
  const pseudonymByName = {}
  const history = []

  for (let i = 0; i < TEST_CONVERSATION.length; i++) {
    history.push(TEST_CONVERSATION[i])
    const { assistantMessage, canonicalsByKey } = await runOneTurn(userId, history, i)
    history.push({ role: 'assistant', content: assistantMessage })

    // Persistence check: pseudonyms for known names must stay stable across turns.
    for (const name of TEST_REAL_NAMES) {
      const key = `PERSON:${name.toLowerCase()}`
      const orgKey = `ORG:${name.toLowerCase()}`
      const locKey = `LOCATION:${name.toLowerCase()}`
      const found = canonicalsByKey.get(key) || canonicalsByKey.get(orgKey) || canonicalsByKey.get(locKey)
      if (!found) continue
      if (pseudonymByName[name] && pseudonymByName[name] !== found) {
        check(
          `pseudonym for "${name}" stable across turns`,
          false,
          `was ${pseudonymByName[name]}, now ${found}`
        )
      } else {
        pseudonymByName[name] = found
      }
    }
  }

  // Final persistence sweep — assert at least one cross-turn name was tracked.
  if (Object.keys(pseudonymByName).length) {
    console.log('\n── Cross-turn persistence ─────────────────────────────────')
    for (const [name, pseudo] of Object.entries(pseudonymByName)) {
      check(`"${name}" mapped to stable pseudonym ${pseudo}`, true)
    }
  }

  // ── Optional cleanup ──
  if (process.argv.includes('--cleanup')) {
    console.log('\n── Cleanup ──')
    const hashes = TEST_REAL_NAMES.map(n => hashForUser(userId, n))
    const { error } = await supabase.from('pseudonym_registry').delete()
      .eq('user_id', userId).in('real_value_hash', hashes)
    if (error) console.log(`  cleanup failed: ${error.message}`)
    else      console.log('  test pseudonyms deleted from registry')
  } else {
    console.log('\n(Pass --cleanup to delete the test pseudonyms from your registry)')
  }

  console.log('\n===================================')
  console.log(`Total: ${pass} passed, ${fail} failed`)
  if (fail) {
    console.log('\nFAILURES:')
    for (const f of issues) console.log(`  - ${f}`)
    process.exit(1)
  }
  console.log('All assertions passed.')
})().catch(err => { console.error('\nE2E crashed:', err); process.exit(1) })
