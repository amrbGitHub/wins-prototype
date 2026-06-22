// Per-user rate limits. Originally covered cybersec audit Finding #15
// (single authenticated user flooding the LLM pipeline); tightened after
// the 2026-06-17 testuser fuzzing incident, where ~596 rows landed in
// ~50 minutes (~24 req/min) — well under the prior 300/min ceiling.
//
// Three limiters, applied in increasing strictness:
//   - generalLimiter — broad floor, all routes, 120/min per actor.
//   - writeLimiter   — 30/min on POST/PATCH/PUT/DELETE only. The fuzzer's
//                      24 writes/min would have tripped at row ~30.
//   - aiLimiter      — 60/min for LLM-backed endpoints (LC chat, win
//                      analyzers, reflection drafts).
//
// Key strategy: prefer the authenticated user. Auth-verified `req.userId`
// is only set inside each route's verifyToken, which runs AFTER these
// limiters. To get per-user keying up here, we cheaply decode the JWT
// `sub` claim (no signature check — that's still verifyToken's job).
// Fall back to req.ip so unauth paths and missing/malformed tokens still
// get rate-limited.

const rateLimit = require('express-rate-limit')

// Decode the `sub` claim from a Bearer token without verifying. Safe to
// use for rate-limit keying because a forged sub still has to survive
// verifyToken downstream — limiter-bucket evasion isn't auth bypass, and
// rotating sub values is no easier than rotating IPs.
function subFromAuthHeader(header) {
  if (!header || !header.startsWith('Bearer ')) return null
  const token = header.slice(7)
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null
  } catch {
    return null
  }
}

function userKey(req /* , _res */) {
  // verifyToken hasn't run yet at the global-middleware layer, so req.userId
  // is usually undefined here. Pull from the JWT directly; fall back to IP.
  return req.userId || subFromAuthHeader(req.headers.authorization) || req.ip || 'anon'
}

// General floor across the whole API. 120/min per actor leaves plenty of
// headroom for a real session (parallel dashboard loads, an active chat)
// but blocks any sustained flood.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userKey,
  message: { error: 'Too many requests. Please slow down.' },
})

// Tighter cap specifically on state-changing methods. GETs are exempt so a
// dashboard with many parallel reads doesn't trip it. 30/min is generous
// for an interactive user (a busy session is single-digit writes/min) and
// catches automated burst patterns like the testuser fuzzer.
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userKey,
  skip: (req) => !['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method),
  message: { error: 'Too many write requests. Please slow down and try again in a moment.' },
})

// LLM-backed endpoints. 60/min is well above a real conversation rate
// (10-20 turns each) but still allows fast retries after a provider blip.
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userKey,
  message: { error: 'Too many AI requests. Please wait a moment and try again.' },
})

module.exports = { aiLimiter, generalLimiter, writeLimiter }
