// Backend redactor + crypto test suite for cybersec audit.
// Run with: node tests/redactor-suite.js
//
// After the frontend-NER refactor, NER detection lives in the browser. This
// suite tests the BACKEND'S responsibilities only:
//   1. redactFromHints — given a text + entity hints (the shape the frontend
//      sends), produces the right pseudonymized text and mapping payload.
//   2. Rehydration round-trips correctly.
//   3. Skip-list still works server-side as defense in depth.
//   4. Crypto invariants (HMAC determinism, AES-GCM round-trip, tamper
//      detection, Postgres bytea hex parsing).
//
// Detection-quality tests for the actual NER (Amro subword bug, Jordan
// threshold, Bloom stopword) now belong with the frontend redactor — they
// only make sense when a real model is loaded, and the model is in the
// browser now. Backend can only test what it does itself: hint → pseudonym.
//
// Exit code: 0 on all pass, 1 on any failure (for CI integration).

if (!process.env.PSEUDONYM_ENCRYPTION_KEY) {
  process.env.PSEUDONYM_ENCRYPTION_KEY = require('node:crypto').randomBytes(32).toString('base64')
}

const { redactFromHints, rehydrateText } = require('../lib/redactor')
const { hashForUser, encryptForUser, decryptForUser } = require('../lib/crypto')

let pass = 0, fail = 0
const failures = []

function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push({ name, detail }); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// Helper: compute hint shape from input + list of (real, type) pairs by
// scanning the text. Keeps the test cases readable.
function hintsFor(text, entries) {
  return entries.map(([real, type]) => {
    const start = text.indexOf(real)
    if (start < 0) throw new Error(`hintsFor: "${real}" not in "${text}"`)
    return { real, type, start, end: start + real.length }
  })
}

function runHintsCorpus() {
  console.log('\n── redactFromHints ──')

  const cases = [
    {
      name:   'single person',
      text:   'Talk to James tomorrow.',
      hints:  hintsFor('Talk to James tomorrow.', [['James', 'PERSON']]),
      mustRedactOut: ['James'],
      mustKeep:      ['tomorrow'],
    },
    {
      name:   'two people in one message',
      text:   'Alex and Sarah cracked the feedback exercise.',
      hints:  hintsFor('Alex and Sarah cracked the feedback exercise.',
                      [['Alex', 'PERSON'], ['Sarah', 'PERSON']]),
      mustRedactOut: ['Alex', 'Sarah'],
      mustKeep:      ['feedback', 'exercise'],
    },
    {
      name:   'company + location',
      text:   'The Detroit office at Acme Corp ran a review.',
      hints:  hintsFor('The Detroit office at Acme Corp ran a review.',
                      [['Detroit', 'LOCATION'], ['Acme Corp', 'ORG']]),
      mustRedactOut: ['Detroit', 'Acme Corp'],
      mustKeep:      ['review'],
    },
    {
      name:   'possessive stays intact',
      text:   "James's manager flagged the issue.",
      hints:  hintsFor("James's manager flagged the issue.", [['James', 'PERSON']]),
      mustRedactOut: ['James'],
      mustKeep:      ["'s", 'manager'],
    },
    {
      name:   'no hints → text unchanged',
      text:   'Nothing to redact here.',
      hints:  [],
      mustRedactOut: [],
      mustKeep:      ['Nothing', 'to', 'redact'],
    },
    {
      name:   'skip-list (user own name)',
      text:   "Hey Amro! What angle should I take with James on his 1:1s?",
      hints:  hintsFor("Hey Amro! What angle should I take with James on his 1:1s?",
                      [['Amro', 'PERSON'], ['James', 'PERSON']]),
      opts:   { skipNames: ['Amro'] },
      mustRedactOut: ['James'],
      mustKeep:      ['Amro'],
    },
  ]

  for (const c of cases) {
    console.log(`\n[${c.name}]`)
    console.log(`  input: "${c.text}"`)
    const { redactedText, mappings } = redactFromHints(c.text, c.hints, c.opts || {})
    console.log(`  redacted: "${redactedText}"`)
    if (mappings.length) {
      console.log(`  mappings: ${mappings.map(m => `${m.real}(${m.type})→${m.pseudonym}`).join(', ')}`)
    }

    for (const sub of c.mustRedactOut) {
      check(`"${sub}" redacted out`, !redactedText.includes(sub),
            redactedText.includes(sub) ? `still in: "${redactedText}"` : '')
    }
    for (const sub of c.mustKeep) {
      check(`"${sub}" preserved`, redactedText.includes(sub),
            !redactedText.includes(sub) ? `missing from: "${redactedText}"` : '')
    }

    // Rehydration round-trip: pseudonyms back to real names → original text.
    const rehydrated = rehydrateText(redactedText, mappings)
    check('rehydration round-trips to original', rehydrated === c.text,
          rehydrated !== c.text ? `got: "${rehydrated}"` : '')
  }
}

function runHintValidation() {
  console.log('\n── hint validation (defensive) ──')
  // Bad hints should be silently dropped, not crash the redactor.
  const text = 'James and Sarah talked.'
  const badHints = [
    { real: 'James', type: 'PERSON',   start: 0,  end: 5  },   // good
    { real: 'X',     type: 'UNKNOWN',  start: 6,  end: 7  },   // bad type — drop
    { real: 'Sarah', type: 'PERSON',   start: 99, end: 104 },  // out of bounds — drop
    { real: 'Bob',   type: 'PERSON',   start: 0,  end: 5  },   // doesn't match text — drop
  ]
  const { redactedText, mappings } = redactFromHints(text, badHints)
  check('only valid hint survived', mappings.length === 1 && mappings[0].real === 'James')
  check('redactor did not crash on bad hints', redactedText.length > 0)
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

  const tampered = Buffer.from(ct)
  tampered[20] ^= 0x01
  let tamperFailed = false
  try { decryptForUser(userA, tampered) } catch { tamperFailed = true }
  check('tampered ciphertext rejected', tamperFailed)

  const hexEncoded = '\\x' + ct.toString('hex')
  const ptFromHex = decryptForUser(userA, hexEncoded)
  check('decrypt accepts Postgres bytea hex string', ptFromHex === 'James',
        ptFromHex !== 'James' ? `got "${ptFromHex}"` : '')
}

;(() => {
  console.log('LC Gateway — Backend Redactor + Crypto Test Suite')
  console.log('=================================================')
  runHintsCorpus()
  runHintValidation()
  runCryptoInvariants()

  console.log('\n=================================================')
  console.log(`Total: ${pass} passed, ${fail} failed`)
  if (fail > 0) {
    console.log('\nFAILURES:')
    for (const f of failures) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`)
    process.exit(1)
  }
  console.log('All tests passed.')
})()
