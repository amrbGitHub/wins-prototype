const { Router } = require('express')
const { supabase } = require('../config')
const { verifyToken } = require('../middleware/auth')
const { dbRowToEntry } = require('../lib/shapes')

const router = Router()

// GET /api/entries — optional ?programId=<uuid> or ?programId=__none__ filter
router.get('/', verifyToken, async (req, res) => {
  try {
    let query = supabase
      .from('journal_entries')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
    if (req.query.programId === '__none__') query = query.is('program_id', null)
    else if (req.query.programId)           query = query.eq('program_id', req.query.programId)
    const { data, error } = await query
    if (error) throw error
    res.json(data.map(dbRowToEntry))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/entries — programId is optional
router.post('/', verifyToken, async (req, res) => {
  try {
    const { date, type, text, programId } = req.body || {}
    if (!text?.trim()) return res.status(400).json({ error: 'Missing text' })
    const { data, error } = await supabase
      .from('journal_entries')
      .insert({
        user_id:         req.userId,
        date,
        type,
        text:            text.trim(),
        analysis:        null,
        analysis_failed: false,
        program_id:      programId || null,
      })
      .select()
      .single()
    if (error) throw error
    res.status(201).json(dbRowToEntry(data))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/entries/:id/analysis
router.patch('/:id/analysis', verifyToken, async (req, res) => {
  try {
    const { analysis, analysisFailed } = req.body || {}
    const patch = {}
    if (analysis      !== undefined) patch.analysis        = analysis
    if (analysisFailed !== undefined) patch.analysis_failed = analysisFailed

    const { data, error } = await supabase
      .from('journal_entries')
      .update(patch)
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select()
      .single()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Entry not found' })
    res.json(dbRowToEntry(data))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/entries/:id — update programId (and future metadata)
// Separate from /analysis so the action of tagging is distinct from AI analysis.
router.patch('/:id', verifyToken, async (req, res) => {
  try {
    const { programId } = req.body || {}
    const patch = {}
    if (programId !== undefined) patch.program_id = programId || null

    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' })

    const { data, error } = await supabase
      .from('journal_entries')
      .update(patch)
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select()
      .single()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Entry not found' })
    res.json(dbRowToEntry(data))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/entries/:id
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { error } = await supabase
      .from('journal_entries')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
    if (error) throw error
    res.status(204).send()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
