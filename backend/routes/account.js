const { Router } = require('express')
const { createClient } = require('@supabase/supabase-js')
const { supabase } = require('../config')
const { verifyToken } = require('../middleware/auth')

const router = Router()

// Fresh client for password verification only — we don't want to mutate the
// shared service-role client's session by calling signInWithPassword on it.
function makeVerifyClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

// POST /api/account/clean-slate — wipe all data this user has generated while
// keeping the auth account + profile intact. User-initiated privacy action.
//
// Requires the user to re-enter their password as a human-verification step.
// A valid session token alone is NOT enough — proves a human at the keyboard,
// not a stolen token or a bot replaying a leaked session.
//
// Deletes, in order so cascades don't have to scramble:
//   1. goals, journal_entries, reflections  — leaf content
//   2. lc_conversations                      — cascades conversation_summaries
//                                              + lc_conversation_pseudonyms
//   3. programs                              — children already gone
//   4. pseudonym_registry                    — cascades pseudonym_summaries
//                                              and removes the encrypted
//                                              real-name mappings
router.post('/clean-slate', verifyToken, async (req, res) => {
  const { password } = req.body || {}
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Password required to confirm.' })
  }

  // Re-verify the password against Supabase auth. If this succeeds, we know
  // the human at the keyboard knows the account password — not just a stolen
  // session token. The returned session is discarded; we only care about the
  // pass/fail signal.
  const verifyClient = makeVerifyClient()
  const { error: authError } = await verifyClient.auth.signInWithPassword({
    email:    req.userEmail,
    password,
  })
  if (authError) {
    return res.status(401).json({ error: 'Password did not match. Try again.' })
  }

  try {
    const tables = [
      'goals',
      'journal_entries',
      'reflections',
      'lc_conversations',
      'programs',
      'pseudonym_registry',
    ]
    const results = {}

    for (const table of tables) {
      const { error, count } = await supabase
        .from(table)
        .delete({ count: 'exact' })
        .eq('user_id', req.userId)
      if (error) {
        results[table] = { error: error.message }
      } else {
        results[table] = { deleted: count ?? 0 }
      }
    }

    res.json({ ok: true, results })
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

module.exports = router
