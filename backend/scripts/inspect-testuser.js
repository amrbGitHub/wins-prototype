// One-off: inspect testuser@gmail.com goals, entries, and LC conversations
// for potential injection / penetration testing payloads.
//
// Usage: node backend/scripts/inspect-testuser.js
// Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from backend/.env.

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true })
const { createClient } = require('@supabase/supabase-js')

const TARGET_EMAIL = 'testuser@gmail.com'

// Heuristics for injection / abuse patterns. Cover SQLi, NoSQL/JSON, prompt
// injection, XSS, command injection, SSRF, path traversal. Case-insensitive.
const PATTERNS = [
  { name: 'sql-union',       re: /\bunion\s+select\b/i },
  { name: 'sql-comment',     re: /(--\s|\/\*|\*\/|#\s)/ },
  { name: 'sql-or-1',        re: /'\s*or\s+['"]?\s*1\s*=\s*1/i },
  { name: 'sql-drop',        re: /\b(drop|truncate|alter)\s+(table|database|schema)\b/i },
  { name: 'sql-quote-break', re: /['"`];\s*(--|\/\*|drop|select|insert|update|delete)/i },
  { name: 'sql-keywords',    re: /\b(information_schema|pg_catalog|pg_sleep|sleep\s*\()/i },
  { name: 'prompt-inject',   re: /(ignore (all |previous |the )?(instructions|prompts)|system prompt|you are now|disregard)/i },
  { name: 'role-leak',       re: /(act as|jailbreak|developer mode|DAN mode|reveal (your )?prompt)/i },
  { name: 'xss',             re: /(<script|javascript:|onerror\s*=|onload\s*=|<iframe|<svg.*onload)/i },
  { name: 'cmd-inject',      re: /(\$\(|`[^`]{0,40}`|\|\s*(curl|wget|nc|bash|sh)\b|;\s*(rm|cat|ls)\s)/i },
  { name: 'path-traversal',  re: /(\.\.[\\/]){2,}/ },
  { name: 'ssrf',            re: /(127\.0\.0\.1|localhost:|169\.254\.169\.254|file:\/\/|\bgopher:\/\/)/i },
  { name: 'template-inject', re: /(\{\{.*\}\}|\$\{.*\}|<%.*%>)/ },
  { name: 'env-probe',       re: /(SUPABASE_|SERVICE_ROLE|process\.env|ANTHROPIC_API|OPENAI_API|PSEUDONYM_ENCRYPTION)/i },
]

function scan(text) {
  if (!text || typeof text !== 'string') return []
  const hits = []
  for (const p of PATTERNS) {
    const m = text.match(p.re)
    if (m) hits.push({ pattern: p.name, snippet: m[0] })
  }
  return hits
}

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  // Find the user by email via admin listUsers (paginated)
  let target = null
  for (let page = 1; page <= 10 && !target; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    target = (data?.users || []).find(u => (u.email || '').toLowerCase() === TARGET_EMAIL)
    if (!data?.users?.length) break
  }
  if (!target) { console.log(`No auth user with email ${TARGET_EMAIL}`); return }

  console.log(`\n=== ${TARGET_EMAIL} ===`)
  console.log(`userId:    ${target.id}`)
  console.log(`createdAt: ${target.created_at}`)
  console.log(`lastSignIn:${target.last_sign_in_at || '(never)'}`)

  const userId = target.id
  const [goalsRes, entriesRes, convRes, profRes] = await Promise.all([
    supabase.from('goals').select('id,title,description,status,progress,month,target_date,created_at,updated_at').eq('user_id', userId).order('created_at', { ascending: true }),
    supabase.from('journal_entries').select('id,date,type,text,created_at').eq('user_id', userId).order('created_at', { ascending: true }),
    supabase.from('lc_conversations').select('id,title,messages,created_at,updated_at').eq('user_id', userId).order('created_at', { ascending: true }),
    supabase.from('profiles').select('first_name,last_name,role').eq('user_id', userId).maybeSingle(),
  ])

  const goals = goalsRes.data || []
  const entries = entriesRes.data || []
  const convs = convRes.data || []

  console.log(`profile:   ${profRes.data?.first_name || ''} ${profRes.data?.last_name || ''} (role=${profRes.data?.role || 'user'})`)
  console.log(`totals:    goals=${goals.length}  entries=${entries.length}  conversations=${convs.length}`)

  // Date range of activity so we can pin down when the testing happened
  const allRows = [
    ...goals.map(g => ({ kind: 'goal', date: g.created_at })),
    ...entries.map(e => ({ kind: 'entry', date: e.created_at })),
    ...convs.map(c => ({ kind: 'conv', date: c.created_at })),
  ].filter(r => r.date).sort((a, b) => a.date.localeCompare(b.date))
  if (allRows.length) {
    console.log(`first activity: ${allRows[0].date} (${allRows[0].kind})`)
    console.log(`last  activity: ${allRows[allRows.length - 1].date} (${allRows[allRows.length - 1].kind})`)

    // Bucket activity by date
    const byDay = new Map()
    for (const r of allRows) {
      const d = r.date.slice(0, 10)
      const b = byDay.get(d) || { goals: 0, entries: 0, conv: 0 }
      if (r.kind === 'goal')  b.goals++
      if (r.kind === 'entry') b.entries++
      if (r.kind === 'conv')  b.conv++
      byDay.set(d, b)
    }
    console.log(`\nactivity by day (top 15 by total):`)
    const sorted = [...byDay.entries()].map(([d, b]) => ({ d, ...b, total: b.goals + b.entries + b.conv }))
      .sort((a, b) => b.total - a.total).slice(0, 15)
    for (const r of sorted) console.log(`  ${r.d}  goals=${r.goals}  entries=${r.entries}  conv=${r.conv}  total=${r.total}`)
  }

  // Scan goals
  console.log(`\n--- goal hits ---`)
  let goalHits = 0
  for (const g of goals) {
    const hits = [...scan(g.title), ...scan(g.description)]
    if (hits.length) {
      goalHits++
      console.log(`[goal ${g.created_at}] ${hits.map(h => h.pattern).join(',')}`)
      console.log(`  title: ${(g.title || '').slice(0, 200)}`)
      if (g.description) console.log(`  desc:  ${g.description.slice(0, 200)}`)
    }
  }
  console.log(`(${goalHits} of ${goals.length} goals flagged)`)

  // Scan entries
  console.log(`\n--- entry hits ---`)
  let entryHits = 0
  for (const e of entries) {
    const hits = scan(e.text)
    if (hits.length) {
      entryHits++
      console.log(`[entry ${e.created_at} type=${e.type}] ${hits.map(h => h.pattern).join(',')}`)
      console.log(`  text: ${(e.text || '').slice(0, 240)}`)
    }
  }
  console.log(`(${entryHits} of ${entries.length} entries flagged)`)

  // Scan chat messages
  console.log(`\n--- conversation hits ---`)
  let msgHits = 0, msgTotal = 0
  for (const c of convs) {
    const msgs = Array.isArray(c.messages) ? c.messages : []
    msgTotal += msgs.length
    for (const m of msgs) {
      if (m.role !== 'user') continue
      const hits = scan(m.content)
      if (hits.length) {
        msgHits++
        console.log(`[conv ${c.id.slice(0, 8)} ${c.created_at}] ${hits.map(h => h.pattern).join(',')}`)
        console.log(`  msg:  ${String(m.content || '').slice(0, 280)}`)
      }
    }
  }
  console.log(`(${msgHits} of ${msgTotal} user messages flagged across ${convs.length} conversations)`)

  // Show a few longest goal titles — long/oddly-shaped titles are a tell
  console.log(`\n--- longest goal titles (top 10) ---`)
  const byLen = [...goals].sort((a, b) => (b.title?.length || 0) - (a.title?.length || 0)).slice(0, 10)
  for (const g of byLen) console.log(`  ${g.created_at}  len=${(g.title || '').length}  ${(g.title || '').slice(0, 160)}`)
}

main().catch(err => { console.error(err); process.exit(1) })
