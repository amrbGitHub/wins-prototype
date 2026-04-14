const { supabase } = require('../config')

// ── Row mappers ───────────────────────────────────────────────────────────────

function dbGoalToShape(row) {
  return {
    id:              row.id,
    month:           row.month,
    title:           row.title,
    description:     row.description,
    successCriteria: row.success_criteria,
    status:          row.status,
    targetDate:      row.target_date   || null,
    steps:           Array.isArray(row.steps) ? row.steps : [],
    progress:        row.progress      ?? 0,
    createdAt:       new Date(row.created_at).getTime(),
  }
}

function dbRowToEntry(row) {
  return {
    id:             row.id,
    date:           row.date,
    type:           row.type,
    text:           row.text,
    analysis:       row.analysis,
    analysisFailed: row.analysis_failed,
    createdAt:      new Date(row.created_at).getTime(),
  }
}

// ── Shared utilities ──────────────────────────────────────────────────────────

// Convert "YYYY-MM" → "March 2026" (or "this month" if invalid)
function toMonthLabel(monthStr) {
  const [y, m] = (monthStr || '').split('-')
  return y && m
    ? new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : 'this month'
}

// Replace all goals for a given user+month atomically.
// Preserves manually-set metadata (targetDate, steps, progress, status) for goals
// whose title matches an existing goal — so reopening the planner never wipes progress.
async function replaceGoals(userId, month, goals) {
  // Fetch existing goals so we can carry forward their metadata
  const { data: existing } = await supabase
    .from('goals')
    .select('title, target_date, steps, progress, status')
    .eq('user_id', userId)
    .eq('month', month)

  const prev = {}
  for (const g of existing || []) prev[g.title] = g

  await supabase.from('goals').delete().eq('user_id', userId).eq('month', month)

  const { data, error } = await supabase
    .from('goals')
    .insert(goals.map(g => {
      const old = prev[g.title] || {}
      return {
        user_id:          userId,
        month,
        title:            g.title,
        description:      g.description,
        success_criteria: g.successCriteria,
        // Preserve existing status (e.g. 'achieved') — never downgrade to 'active'
        status:           old.status || 'active',
        target_date:      g.targetDate || old.target_date || null,
        steps:            g.steps     || old.steps        || [],
        progress:         old.progress ?? 0,
      }
    }))
    .select()

  if (error) throw error
  return data.map(dbGoalToShape)
}

module.exports = { dbGoalToShape, dbRowToEntry, toMonthLabel, replaceGoals }
