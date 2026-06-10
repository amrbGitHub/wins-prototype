const { Router } = require('express')
const { supabase } = require('../config')
const { verifyToken } = require('../middleware/auth')
const { dbProgramToShape, PROGRAM_STATUSES, normaliseProgramStatus } = require('../lib/shapes')

const router = Router()
router.use(verifyToken)   // every route here requires auth

// ── Validation ──────────────────────────────────────────────────────────────
const MAX_NAME_BYTES = 120
const MAX_DESC_BYTES = 2000

function validateName(name) {
  if (typeof name !== 'string') return 'name must be a string'
  const t = name.trim()
  if (!t) return 'name is required'
  if (t.length > MAX_NAME_BYTES) return `name must be ${MAX_NAME_BYTES} chars or fewer`
  return null
}

function validateDate(d) {
  if (d === undefined || d === null || d === '') return null
  // Accept "YYYY-MM-DD" form
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return 'date must be YYYY-MM-DD'
  return null
}

// ── GET /api/programs — list user's programs ────────────────────────────────
// Optional ?status=active|completed|archived to filter.
router.get('/', async (req, res) => {
  try {
    let query = supabase
      .from('programs')
      .select('*')
      .eq('user_id', req.userId)
      .order('updated_at', { ascending: false })

    if (req.query.status) {
      const s = normaliseProgramStatus(req.query.status)
      if (s && PROGRAM_STATUSES.includes(s)) query = query.eq('status', s)
    }

    const { data, error } = await query
    if (error) throw error
    res.json(data.map(dbProgramToShape))
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// ── GET /api/programs/:id — single program ──────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('programs')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Program not found' })
    res.json(dbProgramToShape(data))
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// ── POST /api/programs — create ─────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { name, description, status, startDate, endDate, learnerCount } = req.body || {}
    const nameErr = validateName(name)
    if (nameErr) return res.status(400).json({ error: nameErr })

    const startErr = validateDate(startDate)
    if (startErr) return res.status(400).json({ error: `startDate: ${startErr}` })
    const endErr = validateDate(endDate)
    if (endErr) return res.status(400).json({ error: `endDate: ${endErr}` })

    const s = normaliseProgramStatus(status)
    const finalStatus = (s && PROGRAM_STATUSES.includes(s)) ? s : 'active'

    const lc = (learnerCount === '' || learnerCount === null || learnerCount === undefined)
      ? null
      : Math.max(0, Math.floor(Number(learnerCount) || 0))

    const { data, error } = await supabase
      .from('programs')
      .insert({
        user_id:       req.userId,
        name:          name.trim(),
        description:   (description || '').trim() || null,
        status:        finalStatus,
        start_date:    startDate || null,
        end_date:      endDate   || null,
        learner_count: lc,
      })
      .select()
      .single()
    if (error) throw error
    res.status(201).json(dbProgramToShape(data))
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// ── PATCH /api/programs/:id — update any field ──────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const { name, description, status, startDate, endDate, learnerCount } = req.body || {}
    const patch = {}

    if (name !== undefined) {
      const nameErr = validateName(name)
      if (nameErr) return res.status(400).json({ error: nameErr })
      patch.name = name.trim()
    }
    if (description !== undefined) {
      patch.description = (description || '').trim() || null
    }
    if (status !== undefined) {
      const s = normaliseProgramStatus(status)
      if (!s || !PROGRAM_STATUSES.includes(s)) {
        return res.status(400).json({ error: `status must be one of ${PROGRAM_STATUSES.join(', ')}` })
      }
      patch.status = s
    }
    if (startDate !== undefined) {
      const e = validateDate(startDate)
      if (e) return res.status(400).json({ error: `startDate: ${e}` })
      patch.start_date = startDate || null
    }
    if (endDate !== undefined) {
      const e = validateDate(endDate)
      if (e) return res.status(400).json({ error: `endDate: ${e}` })
      patch.end_date = endDate || null
    }
    if (learnerCount !== undefined) {
      patch.learner_count = (learnerCount === '' || learnerCount === null)
        ? null
        : Math.max(0, Math.floor(Number(learnerCount) || 0))
    }

    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' })

    const { data, error } = await supabase
      .from('programs')
      .update(patch)
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select()
      .single()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Program not found' })
    res.json(dbProgramToShape(data))
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// ── DELETE /api/programs/:id ────────────────────────────────────────────────
// Tagged goals/entries/reflections will have program_id set to NULL via
// ON DELETE SET NULL — their history is preserved, they just become untagged.
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('programs')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
    if (error) throw error
    res.status(204).send()
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// ── GET /api/programs/:id/timeline — aggregated view of everything tagged ───
// Returns a chronological list of goals, journal entries, and reflections
// tagged to this program. Used by the per-program detail page.
router.get('/:id/timeline', async (req, res) => {
  try {
    const programId = req.params.id

    // Verify the program belongs to this user
    const { data: program, error: progErr } = await supabase
      .from('programs')
      .select('id, name')
      .eq('id', programId)
      .eq('user_id', req.userId)
      .single()
    if (progErr) throw progErr
    if (!program) return res.status(404).json({ error: 'Program not found' })

    const [goalsRes, entriesRes, reflectionsRes] = await Promise.all([
      supabase.from('goals').select('*').eq('user_id', req.userId).eq('program_id', programId),
      supabase.from('journal_entries').select('*').eq('user_id', req.userId).eq('program_id', programId),
      supabase.from('reflections').select('*').eq('user_id', req.userId).eq('program_id', programId),
    ])

    const items = []
    for (const g of goalsRes.data || [])      items.push({ kind: 'goal',       data: g, at: g.created_at })
    for (const e of entriesRes.data || [])    items.push({ kind: 'entry',      data: e, at: e.created_at })
    for (const r of reflectionsRes.data || []) items.push({ kind: 'reflection', data: r, at: r.created_at })

    items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

    res.json({
      program: { id: program.id, name: program.name },
      counts: {
        goals:       goalsRes.data?.length ?? 0,
        entries:     entriesRes.data?.length ?? 0,
        reflections: reflectionsRes.data?.length ?? 0,
      },
      items,
    })
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

module.exports = router
