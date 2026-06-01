// Debug: see why "Acme Corp" tokenization breaks aggregation.
const { getPipeline } = require('../lib/redactor')

;(async () => {
  const ner = await getPipeline()
  const text = "The Detroit office team at Acme Corp ran a Kirkpatrick review last week."

  for (const strat of ['simple', 'first', 'average', 'max']) {
    console.log(`\n=== aggregation_strategy: '${strat}' ===`)
    try {
      const result = await ner(text, { aggregation_strategy: strat })
      console.log(JSON.stringify(result, null, 2))
    } catch (e) {
      console.log('ERROR:', e.message)
    }
  }

  console.log('\n=== raw (no aggregation) ===')
  const raw = await ner(text)
  console.log(JSON.stringify(raw, null, 2))
})().catch(err => { console.error(err); process.exit(1) })
