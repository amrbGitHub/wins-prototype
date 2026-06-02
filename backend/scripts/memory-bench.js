// Memory benchmark for the LC gateway backend.
//
// After the frontend-NER refactor, the backend no longer loads any ML model
// — entity detection happens in the user's browser and travels as hints with
// each message. This script verifies the savings: baseline RSS should stay
// well under 200MB for the lifetime of the process.
//
// Run as: node scripts/memory-bench.js
//
// Pass criterion: total RSS under ~250MB after a series of simulated redact
// + canonicalize + rehydrate cycles. Render's 512MB tier should sit
// comfortably with ~250MB of headroom for request handling, the Supabase
// pool, and per-turn allocations.

function mb(bytes) { return (bytes / 1024 / 1024).toFixed(1) }
function snapshot(label) {
  if (global.gc) global.gc()
  const m = process.memoryUsage()
  console.log(
    label.padEnd(46),
    `RSS=${mb(m.rss)}MB`.padEnd(14),
    `heap=${mb(m.heapUsed)}/${mb(m.heapTotal)}MB`.padEnd(20),
    `external=${mb(m.external)}MB`
  )
}

;(async () => {
  process.env.PSEUDONYM_ENCRYPTION_KEY  ||= require('node:crypto').randomBytes(32).toString('base64')
  process.env.ANTHROPIC_API_KEY         ||= 'sk-dummy'
  process.env.SUPABASE_URL              ||= 'https://dummy.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy'

  console.log('\n── LC backend memory benchmark (frontend-NER refactor) ─────────\n')
  snapshot('1. Node startup baseline')

  require('../config')
  snapshot('2. After config (Supabase client + dotenv)')

  require('../lib/crypto')
  require('../lib/actionResolver')
  require('../lib/claude')
  require('../lib/tools')
  require('../lib/summaries')
  snapshot('3. After lib/* + Anthropic SDK')

  const redactor = require('../lib/redactor')
  snapshot('4. After lib/redactor (no model — pure string ops)')

  // Simulate what a real turn does: take a message + pre-computed entity
  // hints (the kind the frontend would send), run redactFromHints, rehydrate.
  const samples = [
    {
      text:  "Marcus from Acme Corp is struggling with feedback in our Boston session.",
      hints: [
        { real: 'Marcus',    type: 'PERSON',   start: 0,  end: 6  },
        { real: 'Acme Corp', type: 'ORG',      start: 12, end: 21 },
        { real: 'Boston',    type: 'LOCATION', start: 56, end: 62 },
      ],
    },
    {
      text:  "Sarah and Priya both attended the workshop in Detroit last week.",
      hints: [
        { real: 'Sarah',   type: 'PERSON',   start: 0,  end: 5  },
        { real: 'Priya',   type: 'PERSON',   start: 10, end: 15 },
        { real: 'Detroit', type: 'LOCATION', start: 46, end: 53 },
      ],
    },
    {
      text:  "Jordan mentioned that the Phoenix team has been quieter than usual.",
      hints: [
        { real: 'Jordan',  type: 'PERSON', start: 0,  end: 6  },
        { real: 'Phoenix', type: 'ORG',    start: 26, end: 33 },
      ],
    },
  ]

  for (let pass = 0; pass < 50; pass++) {
    for (const s of samples) {
      const { redactedText, mappings } = redactor.redactFromHints(s.text, s.hints)
      redactor.rehydrateText(redactedText, mappings)
    }
  }
  snapshot('5. After 150 redact+rehydrate cycles')

  console.log('\nRender 512MB tier requires this to stay under ~400MB total.\n')
})().catch(err => { console.error('Bench crashed:', err); process.exit(1) })
