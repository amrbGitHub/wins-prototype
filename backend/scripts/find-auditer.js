const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true })
const { createClient } = require('@supabase/supabase-js')
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

;(async () => {
  // Who created the 286 goals on 2026-06-17?
  const { data: goals } = await sb.from('goals')
    .select('user_id, title, created_at')
    .gte('created_at', '2026-06-17T00:00:00Z').lt('created_at', '2026-06-18T00:00:00Z')
    .order('created_at', { ascending: true })
  const byUser = new Map()
  for (const g of goals || []) byUser.set(g.user_id, (byUser.get(g.user_id) || 0) + 1)
  console.log('goals 2026-06-17 by user:')
  for (const [u, c] of byUser) console.log(' ', u, c)

  // Get emails for these
  const ids = [...byUser.keys()]
  const { data: auth } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 })
  for (const u of auth?.users || []) {
    if (ids.includes(u.id)) console.log(' email:', u.email, '→', u.id)
  }

  // Sample a few goal titles per user
  for (const uid of ids) {
    const titles = goals.filter(g => g.user_id === uid).slice(0, 5).map(g => g.title)
    console.log('\n sample titles for', uid)
    for (const t of titles) console.log('   -', (t || '').slice(0, 120))
  }

  // Now check llm_usage for these users in a wider window
  console.log('\n-- llm_usage rows for these users (any time) --')
  for (const uid of ids) {
    const { count } = await sb.from('llm_usage').select('*', { count: 'exact', head: true }).eq('user_id', uid)
    console.log(' ', uid, 'rows=', count)
  }
})().catch(e => { console.error(e); process.exit(1) })
