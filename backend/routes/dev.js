const { Router } = require('express')
const { supabase } = require('../config')
const { verifyToken } = require('../middleware/auth')

const router = Router()

// Hard-block this whole router in production. Testing-only utilities never ship.
router.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' })
  }
  next()
})

// POST /api/dev/clean-slate — wipe all user data EXCEPT auth + profile.
// Deletes: goals, journal_entries, reflections, lc_conversations.
// Used for testing only. Auth-scoped (only the calling user's data is touched).
router.post('/clean-slate', verifyToken, async (req, res) => {
  try {
    const tables = ['goals', 'journal_entries', 'reflections', 'lc_conversations']
    const results = {}

    for (const table of tables) {
      const { error, count } = await supabase
        .from(table)
        .delete({ count: 'exact' })
        .eq('user_id', req.userId)
      if (error) {
        // Tolerate missing tables (e.g. lc_conversations if migration not yet run)
        results[table] = { error: error.message }
      } else {
        results[table] = { deleted: count ?? 0 }
      }
    }

    res.json({ ok: true, results })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
