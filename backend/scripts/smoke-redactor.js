// Smoke test for the redactor module. Run with: node scripts/smoke-redactor.js
// First run downloads the ~110MB NER model — subsequent runs are fast (cached).

const { redactText } = require('../lib/redactor')

const samples = [
  "Today James was struggling with communication, what are some ways I can coach him?",
  "Alex from the May Leadership Cohort cracked the feedback exercise. Sarah noticed too.",
  "The Detroit office team at Acme Corp ran a Kirkpatrick L3 review last week.",
  "We need to update Project Phoenix before the Q3 launch in Toronto.",
  "I want to create a new program",  // No PII — should pass through unchanged.
]

;(async () => {
  console.log('Loading NER pipeline (first run downloads ~110MB)…\n')
  const t0 = Date.now()
  for (const text of samples) {
    const { redactedText, mappings } = await redactText(text)
    console.log('INPUT :', text)
    console.log('OUTPUT:', redactedText)
    console.log('MAPS  :', mappings.map(m => `${m.real}(${m.type}, ${m.score.toFixed(2)})→${m.pseudonym}`).join(', ') || '(none)')
    console.log()
  }
  console.log(`Total time: ${((Date.now() - t0) / 1000).toFixed(2)}s`)
})().catch(err => {
  console.error('Smoke test failed:', err)
  process.exit(1)
})
