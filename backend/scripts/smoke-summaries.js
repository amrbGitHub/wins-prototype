// Smoke test for BYTEA round-trip through Supabase.
// Run with: node scripts/smoke-summaries.js <userId>
//
// Writes a known summary string for a known registry id, reads it back,
// decrypts it. Tells us whether the suspected supabase-js Buffer-to-BYTEA
// serialization bug is real.

require('dotenv').config({ override: true })
const { supabase } = require('../config')
const { encryptForUser, decryptForUser } = require('../lib/crypto')

async function main() {
  const userId = process.argv[2]
  if (!userId) {
    console.error('Usage: node scripts/smoke-summaries.js <userId>')
    process.exit(1)
  }

  // Grab any existing registry id for this user so we have a valid FK target.
  const { data: regRows, error: regErr } = await supabase
    .from('pseudonym_registry')
    .select('id, pseudonym')
    .eq('user_id', userId)
    .limit(1)
  if (regErr) throw regErr
  if (!regRows?.length) {
    console.error('No pseudonym_registry rows for this user yet. Chat with LC once to seed one, then re-run.')
    process.exit(1)
  }
  const regId = regRows[0].id
  console.log('using registry id', regId, '(pseudonym:', regRows[0].pseudonym, ')')

  // Helper — write one shape, read back, attempt decrypt, report.
  async function attempt(label, payload) {
    console.log(`\n── ${label} ──`)
    const { error: upErr } = await supabase
      .from('pseudonym_summaries')
      .upsert({
        pseudonym_registry_id: regId,
        encrypted_summary:     payload,
        updated_at:            new Date().toISOString(),
      }, { onConflict: 'pseudonym_registry_id' })
    if (upErr) { console.log('  upsert failed:', upErr.message); return false }

    const { data: row, error: selErr } = await supabase
      .from('pseudonym_summaries')
      .select('encrypted_summary')
      .eq('pseudonym_registry_id', regId)
      .single()
    if (selErr) { console.log('  select failed:', selErr.message); return false }
    console.log('  read-back type:', typeof row.encrypted_summary,
                '— first 24 chars:', String(row.encrypted_summary).slice(0, 24))

    try {
      const decoded = decryptForUser(userId, row.encrypted_summary)
      const ok = decoded === plaintext
      console.log('  decrypt:', ok ? 'PASS ✓' : `MISMATCH (got ${JSON.stringify(decoded)})`)
      return ok
    } catch (e) {
      console.log('  decrypt FAILED ✗', e.message)
      return false
    }
  }

  const plaintext = 'smoke test — round-trip me please'
  const cipherBuf = encryptForUser(userId, plaintext)
  console.log('encrypted length:', cipherBuf.length,
              'bytes; first 8 bytes hex:', cipherBuf.subarray(0, 8).toString('hex'))

  const hexStr    = '\\x' + cipherBuf.toString('hex')
  const base64Str = cipherBuf.toString('base64')

  const results = {
    'Buffer (current code path)':         await attempt('Buffer',           cipherBuf),
    'Postgres-native "\\x<hex>" string':  await attempt('\\x<hex> string',  hexStr),
    'base64 string':                      await attempt('base64 string',    base64Str),
  }

  console.log('\n── summary ──')
  for (const [label, ok] of Object.entries(results)) {
    console.log(`  ${ok ? '✓' : '✗'}  ${label}`)
  }
  console.log('\nUse the first format that PASSES as the write-side encoding.')
}

main().catch(e => { console.error(e); process.exit(1) })
