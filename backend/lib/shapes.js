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

// Replace all goals for a given user+month atomically (delete then insert).
// Returns the inserted rows mapped to frontend shape, or throws on error.
async function replaceGoals(userId, month, goals) {
  await supabase.from('goals').delete().eq('user_id', userId).eq('month', month)
  const { data, error } = await supabase
    .from('goals')
    .insert(goals.map(g => ({
      user_id:          userId,
      month,
      title:            g.title,
      description:      g.description,
      success_criteria: g.successCriteria,
      status:           'active',
    })))
    .select()
  if (error) throw error
  return data.map(dbGoalToShape)
}

module.exports = { dbGoalToShape, dbRowToEntry, toMonthLabel, replaceGoals }
