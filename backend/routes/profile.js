const { Router } = require('express')
const { supabase } = require('../config')
const { verifyToken, isAdminEmail } = require('../middleware/auth')

const router = Router()

function mapProfile(row) {
  return {
    id:            row.id,
    firstName:     row.first_name,
    lastName:      row.last_name,
    learningStyle: row.learning_style,
    aiPersonality: row.ai_personality,
    onboardedAt:   row.onboarded_at,
    role:          row.role || 'user',
  }
}

// GET /api/profile — fetch the current user's profile (null if not set up yet).
// If the caller is on the admin email allowlist, force role='admin' on the
// response and lazily reconcile the DB column so the cached value matches.
router.get('/', verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', req.userId)
      .single()
    if (error && error.code !== 'PGRST116') throw error   // PGRST116 = no rows

    const adminByEmail = isAdminEmail(req.userEmail)

    if (!data) {
      // No profile row yet (user hasn't onboarded). Still report admin-ness
      // so the frontend can show the Admin link before onboarding completes.
      return res.json(adminByEmail ? { role: 'admin' } : null)
    }

    // Lazy reconcile: if email allowlist says admin but DB column lags, fix it.
    if (adminByEmail && data.role !== 'admin') {
      await supabase.from('profiles').update({ role: 'admin' }).eq('user_id', req.userId)
      data.role = 'admin'
    }
    res.json(mapProfile(data))
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// GET /api/profile/stats — total wins and goals met for the user (private)
router.get('/stats', verifyToken, async (req, res) => {
  try {
    const [goalsRes, entriesRes] = await Promise.all([
      supabase.from('goals').select('status').eq('user_id', req.userId),
      supabase.from('journal_entries').select('analysis').eq('user_id', req.userId),
    ])
    // canonical "goal complete" status is 'completed' (see batch 2)
    const goalsMet  = (goalsRes.data  || []).filter(g => g.status === 'completed').length
    const totalWins = (entriesRes.data || []).reduce(
      (n, e) => n + (e.analysis?.wins?.length ?? 0), 0
    )
    res.json({ goalsMet, totalWins })
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// POST /api/profile — create or update profile
router.post('/', verifyToken, async (req, res) => {
  try {
    const { firstName, lastName, learningStyle, aiPersonality } = req.body || {}
    const { data, error } = await supabase
      .from('profiles')
      .upsert(
        {
          user_id:       req.userId,
          first_name:    firstName?.trim()    || null,
          last_name:     lastName?.trim()     || null,
          learning_style: learningStyle       || null,
          ai_personality: aiPersonality       || null,
          onboarded_at:  new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select()
      .single()
    if (error) throw error
    res.json(mapProfile(data))
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

module.exports = router
