const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true })
const { createClient } = require('@supabase/supabase-js')

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

;(async () => {
  const { count, error } = await sb.from('llm_usage').select('*', { count: 'exact', head: true })
  console.log('total llm_usage rows:', count, 'err:', error?.message)

  const { data: latest } = await sb.from('llm_usage')
    .select('user_id, purpose, provider, model, input_tokens, output_tokens, created_at')
    .order('created_at', { ascending: false }).limit(10)
  console.log('\nLatest 10:'); for (const r of latest || []) console.log(' ', r)

  const { data: oldest } = await sb.from('llm_usage')
    .select('user_id, purpose, provider, model, input_tokens, output_tokens, created_at')
    .order('created_at', { ascending: true }).limit(5)
  console.log('\nOldest 5:'); for (const r of oldest || []) console.log(' ', r)

  const { data: tu, error: tuErr, count: tuCount } = await sb.from('llm_usage')
    .select('purpose, input_tokens, output_tokens, created_at', { count: 'exact' })
    .eq('user_id', 'a5ac39d6-cf44-43ff-98bd-ad0a5a0168a7')
    .order('created_at', { ascending: true })
  console.log('\ntestuser rows:', tuCount, 'err:', tuErr?.message)
  if (tu?.length) {
    console.log('first:', tu[0])
    console.log('last: ', tu[tu.length - 1])
    let pIn = 0, pOut = 0
    for (const r of tu) { pIn += r.input_tokens || 0; pOut += r.output_tokens || 0 }
    console.log('total tokens: in=', pIn, 'out=', pOut)
  }
})().catch(e => { console.error(e); process.exit(1) })
