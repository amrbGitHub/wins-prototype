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

const { GOAL_STATUSES, normaliseGoalStatus } = require('./shapes')

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

// ── Per-action resolvers ─────────────────────────────────────────────────────
// Each returns { ok, action?, reason?, note? }. Caller threads them through.

function resolveCreateGoal(a) {
  const title = String(a.title || '').trim()
  if (!title) return { ok: false, reason: 'create_goal needs a title' }
  return {
    ok: true,
    action: {
      type: 'create_goal',
      title,
      description: String(a.description || '').trim() || undefined,
    },
  }
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

function resolveLogWin(a) {
  const title = String(a.title || '').trim()
  if (!title) return { ok: false, reason: 'log_win needs a title' }
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
    },
  }
}

function resolveNavigate(a) {
  const allowed = ['goals', 'celebrate', 'reflections', 'home']
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
function resolveActions(rawActions, goals) {
  const actions = []
  const dropped = []
  if (!Array.isArray(rawActions)) return { actions, dropped }

  for (const a of rawActions) {
    if (!a || typeof a !== 'object' || !a.type) {
      dropped.push({ type: 'unknown', reason: 'malformed action' }); continue
    }
    let r
    switch (a.type) {
      case 'create_goal': r = resolveCreateGoal(a); break
      case 'update_goal': r = resolveUpdateGoal(a, goals); break
      case 'delete_goal': r = resolveDeleteGoal(a, goals); break
      case 'log_win':     r = resolveLogWin(a); break
      case 'navigate':    r = resolveNavigate(a); break
      default:
        dropped.push({ type: a.type, reason: `unknown action type "${a.type}"` }); continue
    }
    if (r.ok) actions.push(r.action)
    else      dropped.push({ type: a.type, reason: r.reason })
  }
  return { actions, dropped }
}

// ── Lie detector ─────────────────────────────────────────────────────────────
// If the assistant message claims an action happened ("Renamed —", "Deleted",
// "Marked complete") but no actions survived resolution, the user will see
// silence. Detect this so the frontend can surface a retry.
const ACTION_CLAIM_RE = /\b(created|added|deleted|removed|renamed|updated|marked|logged|shelved|set\s+(?:to\s+)?(?:done|complete|completed))\b/i
function messageClaimsAction(message) {
  if (typeof message !== 'string') return false
  return ACTION_CLAIM_RE.test(message)
}

// ── Intent detection from the user's message ─────────────────────────────────
// Ground truth = what the user asked for. Models lie about what they did; users
// don't lie about what they want (modulo ambiguity). When the user's intent is
// unambiguous, validate the action shape against that intent.
function detectUserIntent(userMessage) {
  if (typeof userMessage !== 'string' || !userMessage) return null
  const m = userMessage.toLowerCase()

  // Order matters: more specific patterns first
  if (/\b(rename|change\s+(?:the\s+)?name|call\s+it|name\s+it|update\s+(?:the\s+)?name)\b/.test(m)) return 'rename'
  if (/\b(delete|remove|drop|get\s+rid\s+of)\b.{0,30}\bgoal\b/.test(m))                            return 'delete_goal'
  if (/\b(mark|set)\b[^.]{0,40}\b(done|complete|completed|finished)\b/.test(m))                    return 'complete'
  if (/\b(shelve|archive|pause|put\s+on\s+(?:hold|pause))\b/.test(m))                              return 'shelve'
  if (/\b\d+\s*%/.test(m) || /\bprogress\b/.test(m))                                               return 'progress'
  if (/\b(create|add|make|new)\b[^.]{0,30}\bgoal\b/.test(m))                                       return 'create_goal'
  if (/\b(log|celebrate)\b[^.]{0,30}\b(win|achievement)\b/.test(m))                                return 'log_win'
  return null
}

// Given a parsed intent and the resolved actions, decide whether the actions
// actually do what the user asked. Returns { ok, reason? }.
function validateIntentMatch(intent, actions) {
  if (!intent || !Array.isArray(actions)) return { ok: true }
  const has = (pred) => actions.some(pred)
  switch (intent) {
    case 'rename':
      return has(a => a.type === 'update_goal' && typeof a.title === 'string' && a.title.trim() !== '')
        ? { ok: true }
        : { ok: false, reason: 'User asked to rename but no update_goal action has a non-empty "title". To rename, set "title" to the new name.' }
    case 'complete':
      return has(a => a.type === 'update_goal' && a.status === 'completed')
        ? { ok: true }
        : { ok: false, reason: 'User asked to mark complete but no action sets status to "completed". Use update_goal with "status":"completed".' }
    case 'delete_goal':
      return has(a => a.type === 'delete_goal')
        ? { ok: true }
        : { ok: false, reason: 'User asked to delete a goal but no delete_goal action was emitted.' }
    case 'shelve':
      return has(a => a.type === 'update_goal' && a.status === 'shelved')
        ? { ok: true }
        : { ok: false, reason: 'User asked to shelve but no action sets status to "shelved". Use update_goal with "status":"shelved".' }
    case 'progress':
      return has(a => a.type === 'update_goal' && typeof a.progress === 'number')
        ? { ok: true }
        : { ok: false, reason: 'User asked to update progress but no action includes a numeric "progress" field.' }
    case 'create_goal':
      return has(a => a.type === 'create_goal')
        ? { ok: true }
        : { ok: false, reason: 'User asked to create a goal but no create_goal action was emitted.' }
    case 'log_win':
      return has(a => a.type === 'log_win')
        ? { ok: true }
        : { ok: false, reason: 'User asked to log a win but no log_win action was emitted.' }
    default:
      return { ok: true }
  }
}

// ── Server-side action synthesis (escape hatch when the model fails) ────────
// When intent detection says the user wanted rename but the model produced
// nothing usable, parse the user's message ourselves and build the action from
// scratch. Ground truth = user's words + user's actual goals. The model is
// bypassed entirely for this branch.

// Extract the new name from a rename instruction. Handles:
//   "rename X to Y" / "rename X to 'Y'"
//   "change the name of X to Y"
//   "update the name of X to Y"
//   "call it Y" / "name it Y"
function extractRenameNewName(message) {
  if (typeof message !== 'string') return null
  // Quoted form anywhere after a rename connector
  const quoted = message.match(/(?:\bto|\bas|\bcalled|\bnamed)\s+["'`]([^"'`]+)["'`]/i)
  if (quoted && quoted[1].trim()) return quoted[1].trim()
  // "call it X" / "name it X"
  const callIt = /(?:\bcall|\bname)\s+(?:it|this|the\s+goal)\s+["'`]?([^"'`.!?]+?)["'`]?(?:[.!?]|$)/i.exec(message)
  if (callIt && callIt[1].trim()) return callIt[1].trim()
  // Generic "to X" / "as X" — last occurrence, stop at sentence end
  const matches = [...message.matchAll(/\s(?:to|as)\s+["'`]?([^"'`.!?]+?)["'`]?(?:[.!?]|$)/gi)]
  if (matches.length) {
    const last = matches[matches.length - 1][1].trim()
    if (last) return last
  }
  return null
}

// Identify the target goal from the user's message. Strip command words and the
// (already-extracted) new name, then fuzzy-match the remainder against goals.
const RENAME_NOISE_RE = /\b(rename|change|update|the|name|call|it|this|to|as|of|goal|its|new)\b/gi
function extractRenameTarget(userMessage, newName, goals) {
  if (!Array.isArray(goals) || !goals.length) return null
  let stripped = String(userMessage || '')
  if (newName) {
    // Remove the literal new name and any quotes around it
    stripped = stripped.replace(newName, ' ')
  }
  stripped = stripped.replace(/['"`]/g, ' ').replace(RENAME_NOISE_RE, ' ').trim()

  // If nothing meaningful remains and there's exactly one goal, that's the target
  if (!stripped) return goals.length === 1 ? goals[0] : null

  const hit = findGoalByRef(goals, stripped)
  return hit?.goal || null
}

// Synthesize a rename action from the user message + their goals, bypassing the LLM.
// Returns { ok, action?, reason? }.
function synthesizeRenameAction(userMessage, goals) {
  const newName = extractRenameNewName(userMessage)
  if (!newName)             return { ok: false, reason: 'could not parse the new name from your message' }
  if (newName.length > 200) return { ok: false, reason: 'new name parsed as too long — likely a parsing error' }
  const target = extractRenameTarget(userMessage, newName, goals)
  if (!target) return { ok: false, reason: 'could not identify which goal to rename — please use the goal\'s title' }
  if (target.title === newName) return { ok: false, reason: 'the goal already has that name' }
  return {
    ok: true,
    action: {
      type:      'update_goal',
      goalId:    target.id,
      goalTitle: target.title,
      title:     newName,
      _synthesized: true,
      _match:    { from: 'your message', to: target.title, confidence: 'synthesized' },
    },
  }
}

module.exports = {
  resolveActions, findGoalByRef, messageClaimsAction,
  detectUserIntent, validateIntentMatch,
  synthesizeRenameAction,
}
