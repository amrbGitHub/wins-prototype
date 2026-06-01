// Reproduce the specific failures from the leaked chat log:
// 1. "Hey Amro!" → "Am" detected instead of "Amro"
// 2. "Jordan and Priya both struggle…" → Jordan not detected

const { getPipeline } = require('../lib/redactor')

;(async () => {
  const ner = await getPipeline()

  const cases = [
    'Hey Amro! What would you like help with right now?',
    'Jordan and Priya both struggle with public speaking, but for different reasons.',
    'Jordan struggles with public speaking.',           // simpler — does Jordan alone work?
    'I talked to Jordan yesterday.',                    // different framing
    'My name is Amro.',                                  // bare Amro
  ]

  for (const text of cases) {
    console.log(`\n=== "${text}" ===`)
    const raw = await ner(text)
    console.log('RAW:')
    for (const t of raw) console.log(`  ${t.entity.padEnd(8)} ${t.score.toFixed(3)} "${t.word}"`)
  }
})().catch(err => { console.error(err); process.exit(1) })
