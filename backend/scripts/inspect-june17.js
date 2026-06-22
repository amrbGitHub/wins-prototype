const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true })
const { createClient } = require('@supabase/supabase-js')
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

;(async () => {
  // Widen to a 2-day window so timezone offsets can't hide rows.
  const { data, count, error } = await sb.from('llm_usage')
    .select('user_id, purpose, model, input_tokens, output_tokens, created_at', { count: 'exact' })
    .gte('created_at', '2026-06-16T00:00:00Z')
    .lt('created_at',  '2026-06-19T00:00:00Z')
    .order('created_at', { ascending: true })
  console.log('llm_usage rows 2026-06-16..18 UTC:', count, 'err:', error?.message)

  const byDay = new Map()
  const byUser = new Map()
  let totalIn = 0, totalOut = 0
  for (const r of data || []) {
    const day = String(r.created_at).slice(0, 10)
    const d = byDay.get(day) || { calls: 0, in: 0, out: 0 }
    d.calls++; d.in += r.input_tokens || 0; d.out += r.output_tokens || 0
    byDay.set(day, d)
    const u = byUser.get(r.user_id) || { calls: 0, in: 0, out: 0 }
    u.calls++; u.in += r.input_tokens || 0; u.out += r.output_tokens || 0
    byUser.set(r.user_id, u)
    totalIn += r.input_tokens || 0; totalOut += r.output_tokens || 0
  }
  console.log('\nby day:'); for (const [d, v] of byDay) console.log(' ', d, v)
  console.log('\nby user:'); for (const [u, v] of byUser) console.log(' ', u, v)
  console.log('\ntotal tokens in/out:', totalIn, totalOut)

  // Also count journal_entries + lc_conversations created by testuser on 17th
  const UID = 'a5ac39d6-cf44-43ff-98bd-ad0a5a0168a7'
  const { count: ec } = await sb.from('journal_entries').select('*', { count: 'exact', head: true })
    .eq('user_id', UID).gte('created_at', '2026-06-17T00:00:00Z').lt('created_at', '2026-06-18T00:00:00Z')
  const { count: cc } = await sb.from('lc_conversations').select('*', { count: 'exact', head: true })
    .eq('user_id', UID).gte('created_at', '2026-06-17T00:00:00Z').lt('created_at', '2026-06-18T00:00:00Z')
  console.log('\ntestuser on 06-17: entries=', ec, 'conversations=', cc)

  // Profiles count and total per-user activity on the 17th
  console.log('\n-- system-wide writes 2026-06-17 --')
  for (const t of ['journal_entries', 'goals', 'lc_conversations', 'reflections', 'programs']) {
    const { count: c } = await sb.from(t).select('*', { count: 'exact', head: true })
      .gte('created_at', '2026-06-17T00:00:00Z').lt('created_at', '2026-06-18T00:00:00Z')
    console.log(' ', t, '=', c)
  }
})().catch(e => { console.error(e); process.exit(1) })
