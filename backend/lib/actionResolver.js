// actionResolver — server-side post-processing of LLM-emitted actions.
//
// The premise: 7B-class local models are bad at copying UUIDs and remembering
// exact enum values, but good at paraphrasing intent. So we let the model emit
// a loose action with a natural-language reference (goalRef) and resolve it
// here against ground-truth data.
//
// Inputs:  rawActions (whatever the LLM produced), goals (the user's actual goals).
// Output:  { actions: <canonical, executable>, notes: <human-readable repair log> }
//
// Anything that can't be repaired is dropped from the actions array, with a
// reason in `notes`. Callers use `notes` to (a) annotate the message, (b) feed
// the lie-detector that decides whether to mark the turn failed.

const { GOAL_STATUSES, normaliseGoalStatus, PROGRAM_STATUSES, normaliseProgramStatus } = require('./shapes')

// ── Fuzzy goal lookup ────────────────────────────────────────────────────────
// Three-stage matcher: exact (case-insensitive) → containment → token overlap.
// Containment + scoring makes "the workshop goal" → "Run leadership workshop"
// reliable for the kinds of paraphrases small models actually produce.
function findGoalByRef(goals, ref) {
  if (!ref || !goals?.length) return null
  const r = String(ref).toLowerCase().trim()
  if (!r) return null

  // 1. Exact title match
  const exact = goals.find(g => g.title.toLowerCase() === r)
  if (exact) return { goal: exact, confidence: 'exact' }

  // 2. Containment (either direction)
  const contains = goals.filter(g => {
    const t = g.title.toLowerCase()
    return t.includes(r) || r.includes(t)
  })
  if (contains.length === 1) return { goal: contains[0], confidence: 'contains' }

  // 3. Token-overlap scoring. Title tokens count double; description tokens single.
  // Stop-words and short tokens stripped to avoid "the" matching everything.
  const STOP = new Set(['the', 'a', 'an', 'my', 'our', 'this', 'that', 'goal', 'goals', 'one', 'and', 'for', 'to', 'of'])
  const tokenize = (s) => new Set(
    String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2 && !STOP.has(t))
  )
  const refTokens = tokenize(r)
  if (!refTokens.size) {
    // Fall back to first containment hit if any (ambiguous but better than nothing)
    return contains.length ? { goal: contains[0], confidence: 'contains-ambiguous' } : null
  }

  let best = null, bestScore = 0
  for (const g of goals) {
    const titleTokens = tokenize(g.title)
    const descTokens  = tokenize(g.description)
    let score = 0
    for (const t of refTokens) {
      if (titleTokens.has(t)) score += 2
      else if (descTokens.has(t)) score += 1
    }
    if (score > bestScore) { bestScore = score; best = g }
  }
  // Require at least one strong token hit (score >= 2 means at least one title token)
  return bestScore >= 2 ? { goal: best, confidence: 'tokens' } : null
}

// ── Fuzzy program lookup ────────────────────────────────────────────────────
// Same three-stage matcher pattern as findGoalByRef but against program names.
function findProgramByRef(programs, ref) {
  if (!ref || !programs?.length) return null
  const r = String(ref).toLowerCase().trim()
  if (!r) return null

  const exact = programs.find(p => p.name.toLowerCase() === r)
  if (exact) return { program: exact, confidence: 'exact' }

  const contains = programs.filter(p => {
    const n = p.name.toLowerCase()
    return n.includes(r) || r.includes(n)
  })
  if (contains.length === 1) return { program: contains[0], confidence: 'contains' }

  const STOP = new Set(['the', 'a', 'an', 'my', 'our', 'this', 'that', 'program', 'cohort', 'group', 'one', 'and', 'for', 'to', 'of'])
  const tokenize = (s) => new Set(
    String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2 && !STOP.has(t))
  )
  const refTokens = tokenize(r)
  if (!refTokens.size) {
    return contains.length ? { program: contains[0], confidence: 'contains-ambiguous' } : null
  }

  let best = null, bestScore = 0
  for (const p of programs) {
    const nameTokens = tokenize(p.name)
    const descTokens = tokenize(p.description)
    let score = 0
    for (const t of refTokens) {
      if (nameTokens.has(t)) score += 2
      else if (descTokens.has(t)) score += 1
    }
    if (score > bestScore) { bestScore = score; best = p }
  }
  return bestScore >= 2 ? { program: best, confidence: 'tokens' } : null
}

// Resolve an optional programRef on an action. Returns the resolved program
// id or null. Never fails the whole action — a bad programRef just becomes
// "no program tag", because programs are an optional dimension.
function resolveProgramTag(a, programs) {
  if (!programs?.length) return null
  if (a.programId) {
    const direct = programs.find(p => p.id === a.programId)
    if (direct) return direct.id
  }
  const ref = String(a.programRef || '').trim()
  if (!ref) return null
  const hit = findProgramByRef(programs, ref)
  return hit?.program?.id || null
}

// ── Per-action resolvers ─────────────────────────────────────────────────────
// Each returns { ok, action?, reason?, note? }. Caller threads them through.

// Validate a YYYY-MM-DD date string. Returns the string if valid, undefined otherwise.
// Doesn't constrain to "in the future" — past dates are user error but we don't reject.
function validateIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined
  const d = new Date(s + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return undefined
  return s
}

function resolveCreateGoal(a, programs) {
  const title = String(a.title || '').trim()
  if (!title) return { ok: false, reason: 'create_goal needs a title' }
  const programId = resolveProgramTag(a, programs)
  return {
    ok: true,
    action: {
      type:        'create_goal',
      title,
      description: String(a.description || '').trim() || undefined,
      targetDate:  validateIsoDate(a.targetDate),
      programId:   programId || undefined,
    },
  }
}

function resolveCreateProgram(a, programs = []) {
  const name = String(a.name || a.title || '').trim()
  if (!name) return { ok: false, reason: 'create_program needs a name' }

  // Duplicate detection — fuzzy-match against existing programs. Local 7B
  // models love to "create" a program the user is already describing. If a
  // plausible match exists, reject and force LC to confirm with the user.
  if (programs.length) {
    const hit = findProgramByRef(programs, name)
    if (hit) {
      return {
        ok: false,
        reason: `a program named "${hit.program.name}" already exists (matched "${name}" → "${hit.program.name}" via ${hit.confidence}). Don't create a duplicate — confirm with the user whether they want to use the existing one.`,
      }
    }
  }

  // Hard minimums. A program needs more than a bare name — without description,
  // dates, OR learner count, there isn't enough shape for it to be useful.
  // Drop the action and tell the model to shape with the user first.
  const desc = String(a.description || '').trim()
  const hasStart = typeof a.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.startDate)
  const hasEnd   = typeof a.endDate   === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.endDate)
  const hasLearners = typeof a.learnerCount === 'number' && a.learnerCount > 0
  const shapeSignals = [desc, hasStart, hasEnd, hasLearners].filter(Boolean).length
  if (shapeSignals < 2) {
    return {
      ok: false,
      reason: `create_program for "${name}" was emitted without enough shaping — needs at least 2 of: description, startDate, endDate, learnerCount. Ask the user about audience, timeline, and format BEFORE creating.`,
    }
  }

  const action = {
    type: 'create_program',
    name,
  }
  if (desc) action.description = desc
  if (hasStart) action.startDate = a.startDate
  if (hasEnd)   action.endDate   = a.endDate
  if (hasLearners) action.learnerCount = Math.floor(a.learnerCount)
  if (typeof a.status === 'string') {
    const s = normaliseProgramStatus(a.status)
    if (s && PROGRAM_STATUSES.includes(s)) action.status = s
  }
  return { ok: true, action }
}

function resolveGoalTargeted(a, goals, opts = {}) {
  // For update_goal we treat `title` as the NEW title, NOT a goalRef.
  // For delete_goal we treat `title` as a fallback goalRef (model often emits it for confirmation display).
  const allowTitleFallback = opts.allowTitleFallback === true

  // Try the model-provided UUID first
  if (a.goalId) {
    const direct = goals.find(g => g.id === a.goalId)
    if (direct) return { ok: true, action: { ...a, goalId: direct.id, goalRef: undefined, goalTitle: direct.title } }
    // UUID was hallucinated — fall through to fuzzy
  }

  // Build the reference string the model gave us
  let ref = String(a.goalRef || '').trim()
  if (!ref && allowTitleFallback) ref = String(a.title || '').trim()

  // Single-active-goal disambiguation: if the user has exactly ONE active goal
  // (or 1 total) and the model didn't supply a clear ref ("the goal", "it",
  // empty), use that goal. The user's intent is unambiguous in this case;
  // refusing because the model was lazy makes us look broken.
  const activeGoals = goals.filter(g => g.status === 'active')
  const candidatePool = activeGoals.length ? activeGoals : goals
  if (candidatePool.length === 1 && (!ref || isVagueRef(ref))) {
    const only = candidatePool[0]
    return {
      ok: true,
      action: { ...a, goalId: only.id, goalRef: undefined, goalTitle: only.title,
                _match: ref ? { from: ref, to: only.title, confidence: 'sole-goal' } : null },
    }
  }

  if (!ref) return { ok: false, reason: 'no goal reference provided' }

  const hit = findGoalByRef(goals, ref)
  if (!hit) return { ok: false, reason: `couldn't find a goal matching "${ref}"` }

  // Attach _match so the frontend can show a "matched 'X' → 'Y'" hint.
  // Only attach when the match was inexact — exact matches don't need explaining.
  const _match = hit.confidence === 'exact'
    ? null
    : { from: ref, to: hit.goal.title, confidence: hit.confidence }

  return {
    ok: true,
    action: { ...a, goalId: hit.goal.id, goalRef: undefined, goalTitle: hit.goal.title, _match },
  }
}

// Detect a goalRef that's just a pronoun/stop-words ("the goal", "it", "my goal").
// When the user has one active goal, these vague refs should resolve to it
// rather than being rejected for "couldn't find a goal matching 'the goal'".
function isVagueRef(ref) {
  if (typeof ref !== 'string') return true
  const r = ref.toLowerCase().trim()
  if (!r) return true
  const VAGUE = new Set([
    'the goal', 'my goal', 'that goal', 'this goal',
    'it', 'this', 'that', 'the one', 'the only one',
    'goal', 'the active goal',
  ])
  return VAGUE.has(r)
}

function resolveUpdateGoal(a, goals) {
  const r = resolveGoalTargeted(a, goals, { allowTitleFallback: false })
  if (!r.ok) return r
  // Strip blank-string / wrong-type fields. Snap status to canonical or drop it.
  const action = {
    type:      'update_goal',
    goalId:    r.action.goalId,
    goalTitle: r.action.goalTitle,
    _match:    r.action._match,
  }
  let touched = 0
  const setStr = (k, v) => {
    if (typeof v !== 'string') return
    const t = v.trim()
    if (t === '') return
    action[k] = t
    touched++
  }
  setStr('title',       a.title)
  setStr('description', a.description)
  const td = validateIsoDate(a.targetDate)
  if (td) { action.targetDate = td; touched++ }
  if (typeof a.progress === 'number' && a.progress >= 0 && a.progress <= 100) {
    action.progress = Math.round(a.progress)
    touched++
  }
  if (a.status !== undefined) {
    const s = normaliseGoalStatus(a.status)
    if (s && GOAL_STATUSES.includes(s)) { action.status = s; touched++ }
    // Silently drop bogus status — better than failing the whole rename
  }
  if (touched === 0) return { ok: false, reason: 'update_goal had no valid fields to change' }
  return { ok: true, action }
}

function resolveDeleteGoal(a, goals) {
  const r = resolveGoalTargeted(a, goals, { allowTitleFallback: true })
  if (!r.ok) return r
  return {
    ok: true,
    action: {
      type:      'delete_goal',
      goalId:    r.action.goalId,
      goalTitle: r.action.goalTitle,
      title:     r.action.goalTitle,    // keep `title` for label compatibility
      _match:    r.action._match,
    },
  }
}

function resolveLogWin(a, programs) {
  const title = String(a.title || '').trim()
  if (!title) return { ok: false, reason: 'log_win needs a title' }
  const programId = resolveProgramTag(a, programs)
  return {
    ok: true,
    action: {
      type: 'log_win',
      title,
      story:    String(a.story    || '').trim() || undefined,
      evidence: String(a.evidence || '').trim() || undefined,
      celebrationIdeas: Array.isArray(a.celebrationIdeas)
        ? a.celebrationIdeas.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim())
        : undefined,
      programId: programId || undefined,
    },
  }
}

function resolveNavigate(a) {
  const allowed = ['goals', 'celebrate', 'reflections', 'home', 'programs']
  const view = String(a.view || '').toLowerCase().trim()
  if (!allowed.includes(view)) return { ok: false, reason: `unknown view "${view}"` }
  return {
    ok: true,
    action: {
      type: 'navigate',
      view,
      label: String(a.label || '').trim() || undefined,
    },
  }
}

// ── Orchestrator ─────────────────────────────────────────────────────────────
function resolveActions(rawActions, goals, programs = []) {
  const actions = []
  const dropped = []
  if (!Array.isArray(rawActions)) return { actions, dropped }

  for (const a of rawActions) {
    if (!a || typeof a !== 'object' || !a.type) {
      dropped.push({ type: 'unknown', reason: 'malformed action' }); continue
    }
    let r
    switch (a.type) {
      case 'create_goal':    r = resolveCreateGoal(a, programs); break
      case 'update_goal':    r = resolveUpdateGoal(a, goals); break
      case 'delete_goal':    r = resolveDeleteGoal(a, goals); break
      case 'log_win':        r = resolveLogWin(a, programs); break
      case 'navigate':       r = resolveNavigate(a); break
      case 'create_program': r = resolveCreateProgram(a, programs); break
      default:
        dropped.push({ type: a.type, reason: `unknown action type "${a.type}"` }); continue
    }
    if (r.ok) actions.push(r.action)
    else      dropped.push({ type: a.type, reason: r.reason })
  }
  return { actions, dropped }
}

module.exports = { resolveActions, findGoalByRef, findProgramByRef }
