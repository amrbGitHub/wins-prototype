// Why does testuser have 0 llm_usage rows despite 610 chat messages?
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true })
const { createClient } = require('@supabase/supabase-js')

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const UID = 'a5ac39d6-cf44-43ff-98bd-ad0a5a0168a7'

;(async () => {
  const { data: audit, count: ac } = await sb.from('lc_message_audit')
    .select('turn_index, real_assistant_text, created_at', { count: 'exact' })
    .eq('user_id', UID).order('created_at', { ascending: true }).limit(5)
  console.log('lc_message_audit rows for testuser:', ac)
  for (const a of audit || []) console.log(' ', a.created_at, 'assistant len=', (a.real_assistant_text || '').length, '"' + (a.real_assistant_text || '').slice(0, 80) + '"')

  // Did any messages get assistant replies? Look at lc_conversations.messages roles.
  const { data: convs } = await sb.from('lc_conversations')
    .select('id, messages').eq('user_id', UID)
  let userMsgs = 0, asstMsgs = 0, asstWithText = 0, errorish = 0
  const samples = []
  for (const c of convs || []) {
    for (const m of c.messages || []) {
      if (m.role === 'user') userMsgs++
      if (m.role === 'assistant') {
        asstMsgs++
        const txt = typeof m.content === 'string' ? m.content : ''
        if (txt) asstWithText++
        if (/error|sorry/i.test(txt) && samples.length < 5) samples.push(txt.slice(0, 200))
        if (/error|sorry/i.test(txt)) errorish++
      }
    }
  }
  console.log('\nuser msgs:', userMsgs, 'assistant msgs:', asstMsgs, 'asst-with-text:', asstWithText, 'error-ish:', errorish)
  console.log('error sample:', samples)
})().catch(e => { console.error(e); process.exit(1) })
