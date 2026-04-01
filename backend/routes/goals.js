const { Router } = require('express')
const { supabase } = require('../config')
const { verifyToken } = require('../middleware/auth')
const { dbGoalToShape } = require('../lib/shapes')

const router = Router()

// GET /api/goals — fetch goals, optional ?month=YYYY-MM filter
router.get('/', verifyToken, async (req, res) => {
  try {
    let query = supabase
      .from('goals')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: true })
    if (req.query.month) query = query.eq('month', req.query.month)
    const { data, error } = await query
    if (error) throw error
    res.json(data.map(dbGoalToShape))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/goals/:id — remove a single goal
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { error } = await supabase
      .from('goals')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
    if (error) throw error
    res.status(204).send()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/goals/:id — update goal status
router.patch('/:id', verifyToken, async (req, res) => {
  try {
    const { status } = req.body || {}
    const { data, error } = await supabase
      .from('goals')
      .update({ status })
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select()
      .single()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Goal not found' })
    res.json(dbGoalToShape(data))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
