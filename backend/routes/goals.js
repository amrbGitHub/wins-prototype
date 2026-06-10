const { Router } = require('express')
const { supabase } = require('../config')
const { verifyToken } = require('../middleware/auth')
const { ollamaChat, getContent, parseJSON } = require('../lib/ollama')
const { dbGoalToShape, GOAL_STATUSES, normaliseGoalStatus } = require('../lib/shapes')

const router = Router()

// GET /api/goals — fetch goals.
// Optional filters: ?month=YYYY-MM, ?programId=<uuid>, ?programId=__none__ (untagged)
router.get('/', verifyToken, async (req, res) => {
  try {
    let query = supabase
      .from('goals')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: true })
    if (req.query.month) query = query.eq('month', req.query.month)
    if (req.query.programId === '__none__') query = query.is('program_id', null)
    else if (req.query.programId)           query = query.eq('program_id', req.query.programId)
    const { data, error } = await query
    if (error) throw error
    res.json(data.map(dbGoalToShape))
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// POST /api/goals — create a goal manually
router.post('/', verifyToken, async (req, res) => {
  try {
    const { title, description, successCriteria, targetDate, month: bodyMonth, programId } = req.body || {}
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' })

    // Default to UTC month if client didn't supply one. The frontend always supplies
    // a local-tz month for new goals so this is just a safety fallback.
    const month = bodyMonth || new Date().toISOString().slice(0, 7)

    const { data, error } = await supabase
      .from('goals')
      .insert({
        user_id:          req.userId,
        month,
        title:            title.trim(),
        description:      description?.trim() || null,
        success_criteria: successCriteria?.trim() || null,
        target_date:      targetDate || null,
        status:           'active',
        progress:         0,
        steps:            [],
        program_id:       programId || null,
      })
      .select()
      .single()
    if (error) throw error
    res.status(201).json(dbGoalToShape(data))
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// POST /api/goals/transfer — copy goals from one month to another
// Static route must come before POST /:id/steps
router.post('/transfer', verifyToken, async (req, res) => {
  try {
    const { fromMonth, toMonth, goalIds } = req.body || {}
    if (!fromMonth || !toMonth || !Array.isArray(goalIds)) {
      return res.status(400).json({ error: 'fromMonth, toMonth, and goalIds required' })
    }

    const { data: source, error: fetchErr } = await supabase
      .from('goals')
      .select('*')
      .eq('user_id', req.userId)
      .eq('month', fromMonth)
      .in('id', goalIds)
    if (fetchErr) throw fetchErr

    if (!source?.length) return res.json({ goals: [] })

    const { data: inserted, error: insertErr } = await supabase
      .from('goals')
      .insert(source.map(g => ({
        user_id:          req.userId,
        month:            toMonth,
        title:            g.title,
        description:      g.description,
        success_criteria: g.success_criteria,
        status:           'active',
        target_date:      g.target_date || null,
        steps:            g.steps       || [],
        progress:         0,
      })))
      .select()
    if (insertErr) throw insertErr

    res.json({ goals: inserted.map(dbGoalToShape) })
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// PATCH /api/goals/bulk-status — mark multiple goals shelved / active
// Static route must come before PATCH /:id
router.patch('/bulk-status', verifyToken, async (req, res) => {
  try {
    const { goalIds, status } = req.body || {}
    if (!Array.isArray(goalIds) || !status) return res.status(400).json({ error: 'goalIds and status required' })
    const s = normaliseGoalStatus(status)
    if (s === null || !GOAL_STATUSES.includes(s)) {
      return res.status(400).json({ error: `status must be one of ${GOAL_STATUSES.join(', ')}` })
    }
    const { error } = await supabase
      .from('goals')
      .update({ status: s })
      .eq('user_id', req.userId)
      .in('id', goalIds)
    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// POST /api/goals/rollover — bundle transfer + shelve in a single best-effort atomic op
// Static route must come before /:id routes.
// Sequenced: shelve first (cheap), then transfer (expensive). If transfer fails,
// we revert the shelve so the user isn't left in a half-applied state.
router.post('/rollover', verifyToken, async (req, res) => {
  try {
    const { fromMonth, toMonth, transferIds = [], shelfIds = [] } = req.body || {}
    if (!fromMonth || !toMonth) return res.status(400).json({ error: 'fromMonth, toMonth required' })
    if (!Array.isArray(transferIds) || !Array.isArray(shelfIds)) {
      return res.status(400).json({ error: 'transferIds and shelfIds must be arrays' })
    }

    // 1. Shelve (capture prior status for revert)
    let shelvedRevert = null
    if (shelfIds.length) {
      const { data: prev, error: priorErr } = await supabase
        .from('goals').select('id, status')
        .eq('user_id', req.userId).in('id', shelfIds)
      if (priorErr) throw priorErr
      shelvedRevert = prev || []

      const { error: updateErr } = await supabase
        .from('goals').update({ status: 'shelved' })
        .eq('user_id', req.userId).in('id', shelfIds)
      if (updateErr) throw updateErr
    }

    // 2. Transfer (with revert on failure)
    let transferred = []
    if (transferIds.length) {
      const { data: source, error: fetchErr } = await supabase
        .from('goals').select('*')
        .eq('user_id', req.userId).eq('month', fromMonth).in('id', transferIds)
      if (fetchErr) {
        if (shelvedRevert) await Promise.all(shelvedRevert.map(g =>
          supabase.from('goals').update({ status: g.status }).eq('id', g.id).eq('user_id', req.userId)
        ))
        throw fetchErr
      }

      if (source?.length) {
        const { data: inserted, error: insertErr } = await supabase
          .from('goals')
          .insert(source.map(g => ({
            user_id:          req.userId,
            month:            toMonth,
            title:            g.title,
            description:      g.description,
            success_criteria: g.success_criteria,
            status:           'active',
            target_date:      g.target_date || null,
            steps:            g.steps       || [],
            progress:         0,
          })))
          .select()
        if (insertErr) {
          // Roll back the shelve
          if (shelvedRevert) await Promise.all(shelvedRevert.map(g =>
            supabase.from('goals').update({ status: g.status }).eq('id', g.id).eq('user_id', req.userId)
          ))
          throw insertErr
        }
        transferred = (inserted || []).map(dbGoalToShape)
      }
    }

    res.json({ ok: true, transferred, shelvedCount: shelfIds.length })
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
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
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// PATCH /api/goals/:id — update title, description, status, progress, targetDate, steps, programId
router.patch('/:id', verifyToken, async (req, res) => {
  try {
    const { title, description, status, progress, targetDate, steps, programId } = req.body || {}

    const patch = {}
    if (title       !== undefined) patch.title        = (title || '').trim() || null
    if (description !== undefined) patch.description  = (description || '').trim() || null
    if (status      !== undefined) {
      const s = normaliseGoalStatus(status)
      if (s === null) {
        // Blank/empty — caller (likely the LLM) padded the field; treat as not provided.
      } else if (!GOAL_STATUSES.includes(s)) {
        return res.status(400).json({ error: `status must be one of ${GOAL_STATUSES.join(', ')}` })
      } else {
        patch.status = s
      }
    }
    if (progress    !== undefined) patch.progress     = Math.max(0, Math.min(100, Number(progress)))
    if (targetDate  !== undefined) patch.target_date  = targetDate || null
    if (steps       !== undefined) patch.steps        = steps
    if (programId   !== undefined) patch.program_id   = programId || null    // null = untag

    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' })

    const { data, error } = await supabase
      .from('goals')
      .update(patch)
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select()
      .single()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Goal not found' })
    res.json(dbGoalToShape(data))
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// POST /api/goals/:id/steps — generate actionable steps for a goal via AI
router.post('/:id/steps', verifyToken, async (req, res) => {
  try {
    const { data: goal, error: fetchErr } = await supabase
      .from('goals')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single()
    if (fetchErr || !goal) return res.status(404).json({ error: 'Goal not found' })

    const completion = await ollamaChat({
      messages: [
        {
          role: 'system',
          content: `
You are a practical planning coach. Break a goal down into 3–5 clear, concrete, actionable steps.
Each step should be something the person can actually do — not vague advice.
Return ONLY valid JSON:
{"steps":[{"id":"step-1","title":"...","completed":false},{"id":"step-2","title":"...","completed":false}]}
          `.trim(),
        },
        {
          role: 'user',
          content: `Goal: ${goal.title}\nDescription: ${goal.description || ''}\nSuccess criteria: ${goal.success_criteria || ''}\n\nBreak this into 3–5 concrete steps.`,
        },
      ],
      temperature: 0.4,
      json: true,
    })

    const parsed = parseJSON(getContent(completion))
    const steps  = Array.isArray(parsed.steps) ? parsed.steps : []

    const { data: updated, error: updateErr } = await supabase
      .from('goals')
      .update({ steps })
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select()
      .single()
    if (updateErr) throw updateErr

    res.json(dbGoalToShape(updated))
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

module.exports = router
