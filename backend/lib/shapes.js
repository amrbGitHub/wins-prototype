const { supabase } = require('../config')

// ── Row mappers ───────────────────────────────────────────────────────────────

function dbGoalToShape(row) {
  return {
    id:              row.id,
    month:           row.month,
    title:           row.title,
    description:     row.description,
    successCriteria: row.success_criteria,
    status:          normaliseGoalStatus(row.status),
    targetDate:      row.target_date   || null,
    steps:           Array.isArray(row.steps) ? row.steps : [],
    progress:        row.progress      ?? 0,
    programId:       row.program_id    || null,
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
    programId:      row.program_id || null,
    createdAt:      new Date(row.created_at).getTime(),
  }
}

// ── Program statuses ────────────────────────────────────────────────────────
const PROGRAM_STATUSES = ['active', 'completed', 'archived']
function normaliseProgramStatus(status) {
  if (status === undefined || status === null) return null
  const s = String(status).trim().toLowerCase()
  if (s === '') return null
  // Reuse goal-status synonyms where they overlap (done → completed, shelved → archived-ish)
  // but be explicit: 'shelved' for a program means 'archived'.
  if (s === 'done' || s === 'complete' || s === 'finished') return 'completed'
  if (s === 'shelved' || s === 'shelve' || s === 'paused' || s === 'archive') return 'archived'
  return s
}

function dbProgramToShape(row) {
  return {
    id:           row.id,
    name:         row.name,
    description:  row.description,
    status:       row.status,
    startDate:    row.start_date || null,
    endDate:      row.end_date   || null,
    learnerCount: row.learner_count ?? null,
    createdAt:    new Date(row.created_at).getTime(),
    updatedAt:    new Date(row.updated_at).getTime(),
  }
}

// ── Shared utilities ──────────────────────────────────────────────────────────

// Convert "YYYY-MM" → "March 2026" (or "this month" if invalid)
function toMonthLabel(monthStr) {
  const [y, m] = (monthStr || '').split('-')
  return y && m
    ? new Date(parseInt(y, 10), parseInt(m, 10) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : 'this month'
}

// Canonical goal status values used across DB + UI + LC actions.
const GOAL_STATUSES        = ['active', 'completed', 'shelved']
const GOAL_COMPLETE_STATUS = 'completed'

// Returns one of GOAL_STATUSES, or null if the input is blank / unset.
// Throws nothing — caller decides whether null means "skip" (PATCH) or "reject".
// Maps the synonyms LLMs naturally produce ('done', 'archived', etc.) to canonical values.
const STATUS_SYNONYMS = {
  achieved:  'completed',   // legacy DB rows
  done:      'completed',
  complete:  'completed',
  finished:  'completed',
  archived:  'shelved',
  archive:   'shelved',
  shelve:    'shelved',
  paused:    'shelved',
}
function normaliseGoalStatus(status) {
  if (status === undefined || status === null) return null
  const s = String(status).trim().toLowerCase()
  if (s === '') return null
  return STATUS_SYNONYMS[s] || s
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

module.exports = {
  dbGoalToShape, dbRowToEntry, dbProgramToShape, toMonthLabel, replaceGoals,
  GOAL_STATUSES, GOAL_COMPLETE_STATUS, normaliseGoalStatus,
  PROGRAM_STATUSES, normaliseProgramStatus,
}
