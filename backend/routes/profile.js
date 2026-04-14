const { Router } = require('express')
const { supabase } = require('../config')
const { verifyToken } = require('../middleware/auth')

const router = Router()

function mapProfile(row) {
  return {
    id:            row.id,
    firstName:     row.first_name,
    lastName:      row.last_name,
    username:      row.username,
    learningStyle: row.learning_style,
    aiPersonality: row.ai_personality,
    onboardedAt:   row.onboarded_at,
  }
}

// GET /api/profile — fetch the current user's profile (null if not set up yet)
router.get('/', verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', req.userId)
      .single()
    if (error && error.code !== 'PGRST116') throw error   // PGRST116 = no rows
    res.json(data ? mapProfile(data) : null)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/profile/stats — total wins and goals met for the user (private)
router.get('/stats', verifyToken, async (req, res) => {
  try {
    const [goalsRes, entriesRes] = await Promise.all([
      supabase.from('goals').select('status').eq('user_id', req.userId),
      supabase.from('entries').select('analysis').eq('user_id', req.userId),
    ])
    const goalsMet  = (goalsRes.data  || []).filter(g => g.status === 'achieved').length
    const totalWins = (entriesRes.data || []).reduce(
      (n, e) => n + (e.analysis?.wins?.length ?? 0), 0
    )
    res.json({ goalsMet, totalWins })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/profile — create or update profile
router.post('/', verifyToken, async (req, res) => {
  try {
    const { firstName, lastName, username, learningStyle, aiPersonality } = req.body || {}
    const { data, error } = await supabase
      .from('profiles')
      .upsert(
        {
          user_id:       req.userId,
          first_name:    firstName?.trim()    || null,
          last_name:     lastName?.trim()     || null,
          username:      username?.trim()     || null,
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
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
