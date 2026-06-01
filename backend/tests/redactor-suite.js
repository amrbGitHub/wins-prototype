// Redactor + rehydrator + crypto test suite for cybersec audit.
// Run with: node tests/redactor-suite.js
//
// What this validates:
//   1. PII REDACTION: for each corpus entry, none of the `mustRedact` strings
//      survive in the redactedText that would be sent to Claude.
//   2. NON-PII PRESERVATION: `mustKeep` strings are preserved (false-positive
//      check).
//   3. REHYDRATION ROUND-TRIP: redactedText + mappings → rehydrates back to
//      the original input exactly.
//   4. INTRA-MESSAGE CONSISTENCY: when `intraConsistency` is set, repeated
//      real values map to the SAME pseudonym within a single redactText call.
//   5. CRYPTO INVARIANTS: HMAC determinism, per-user hash isolation,
//      encrypt/decrypt round-trip, cross-user decrypt rejection.
//
// What this does NOT validate (covered by task #8 end-to-end smoke):
//   - Cross-call pseudonym persistence (registry round-trip — needs Supabase).
//   - Actual Claude API integration.
//
// Exit code: 0 on all pass, 1 on any failure (for CI integration).

if (!process.env.PSEUDONYM_ENCRYPTION_KEY) {
  process.env.PSEUDONYM_ENCRYPTION_KEY = require('node:crypto').randomBytes(32).toString('base64')
}

const { redactText, rehydrateText } = require('../lib/redactor')
const { hashForUser, encryptForUser, decryptForUser } = require('../lib/crypto')
const corpus = require('./redactor-corpus')

let pass = 0
let fail = 0
const failures = []

function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    failures.push({ name, detail })
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function runRedactorCorpus() {
  console.log('\n── Redactor corpus ──')
  for (const entry of corpus) {
    console.log(`\n[${entry.name}]`)
    console.log(`  input: "${entry.input}"`)
    const { redactedText, mappings } = await redactText(entry.input)
    console.log(`  redacted: "${redactedText}"`)
    if (mappings.length) {
      console.log(`  mappings: ${mappings.map(m => `${m.real}(${m.type})→${m.pseudonym}`).join(', ')}`)
    }

    // 1. mustRedact — none of these substrings may survive
    for (const sub of entry.mustRedact || []) {
      check(
        `"${sub}" is redacted out`,
        !redactedText.includes(sub),
        redactedText.includes(sub) ? `still present in: "${redactedText}"` : ''
      )
    }

    // 2. mustKeep — these substrings must be preserved
    for (const sub of entry.mustKeep || []) {
      check(
        `"${sub}" is preserved`,
        redactedText.includes(sub),
        !redactedText.includes(sub) ? `missing from: "${redactedText}"` : ''
      )
    }

    // 3. Rehydration round-trip
    const rehydrated = rehydrateText(redactedText, mappings)
    check(
      'rehydration round-trips to original',
      rehydrated === entry.input,
      rehydrated !== entry.input ? `got: "${rehydrated}"` : ''
    )

    // 4. Intra-message consistency: repeated real values → same pseudonym
    if (entry.intraConsistency) {
      const byReal = new Map()
      let consistent = true
      for (const m of mappings) {
        const key = m.real.toLowerCase()
        if (byReal.has(key) && byReal.get(key) !== m.pseudonym) consistent = false
        byReal.set(key, m.pseudonym)
      }
      check('repeated reals map to same pseudonym', consistent)
    }
  }
}

async function runSkipNamesCheck() {
  console.log('\n── skipNames (user-self exemption) ──')
  // The user's own name should NOT be redacted even when the AI greets them.
  // Other names in the same message MUST still be redacted normally.
  const text = "Hey Amro! What angle should I take with James on his 1:1s?"
  const { redactedText, mappings } = await redactText(text, { skipNames: ['Amro'] })
  console.log(`  input:    "${text}"`)
  console.log(`  redacted: "${redactedText}"`)
  check('user\'s own name "Amro" is preserved',  redactedText.includes('Amro'))
  check('other name "James" still redacted out', !redactedText.includes('James'))
  check('mappings do not contain "Amro"',        !mappings.some(m => m.real.toLowerCase() === 'amro'))
  check('mappings do contain "James"',           mappings.some(m => m.real === 'James'))
}

function runCryptoInvariants() {
  console.log('\n── Crypto invariants ──')
  const userA = '11111111-1111-1111-1111-111111111111'
  const userB = '22222222-2222-2222-2222-222222222222'

  const h1 = hashForUser(userA, 'James')
  const h2 = hashForUser(userA, 'james')
  const h3 = hashForUser(userA, 'James')
  check('hash deterministic (case-insensitive)', h1 === h2 && h2 === h3)

  const h4 = hashForUser(userB, 'James')
  check('hash differs across users for same value', h1 !== h4)

  const ct = encryptForUser(userA, 'James')
  const pt = decryptForUser(userA, ct)
  check('encrypt → decrypt round-trip', pt === 'James',
    pt !== 'James' ? `got "${pt}"` : '')

  let crossUserFailed = false
  try { decryptForUser(userB, ct) } catch { crossUserFailed = true }
  check('cross-user decrypt rejected (AES-GCM tag mismatch)', crossUserFailed)

  // Tamper detection: flip a byte in the ciphertext, decrypt should throw.
  const tampered = Buffer.from(ct)
  tampered[20] ^= 0x01
  let tamperFailed = false
  try { decryptForUser(userA, tampered) } catch { tamperFailed = true }
  check('tampered ciphertext rejected', tamperFailed)

  // Decrypt accepts Postgres bytea hex-string format (the shape supabase-js
  // returns for BYTEA columns). Regression for "ciphertext too short" bug.
  const hexEncoded = '\\x' + ct.toString('hex')
  const ptFromHex = decryptForUser(userA, hexEncoded)
  check('decrypt accepts Postgres bytea hex string', ptFromHex === 'James',
    ptFromHex !== 'James' ? `got "${ptFromHex}"` : '')
}

;(async () => {
  console.log('LC Gateway — Redactor + Crypto Test Suite')
  console.log('=========================================')
  await runRedactorCorpus()
  await runSkipNamesCheck()
  runCryptoInvariants()

  console.log('\n=========================================')
  console.log(`Total: ${pass} passed, ${fail} failed`)
  if (fail > 0) {
    console.log('\nFAILURES:')
    for (const f of failures) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`)
    process.exit(1)
  }
  console.log('All tests passed.')
})().catch(err => { console.error('Suite crashed:', err); process.exit(1) })
