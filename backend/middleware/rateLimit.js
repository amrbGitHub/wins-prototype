// Per-user rate limits for AI-backed endpoints. Addresses cybersec audit
// Finding #15: prevent a single authenticated user from flooding the LLM
// pipeline and degrading service for everyone else.
//
// Limits intentionally generous for normal trainer usage; tighter on the
// expensive AI paths than on cheap CRUD. Tune from observed traffic later.
//
// Key strategy: prefer the authenticated user id (req.userId, set by
// verifyToken). Fall back to IP for unauthenticated paths so a single
// IP can't brute-force /api/health.

const rateLimit = require('express-rate-limit')

function userKey(req /* , _res */) {
  return req.userId || req.ip || 'anon'
}

// Heavy AI endpoints — LC chat, win analyzers, reflection drafts, etc.
// 60 requests per minute per user. A real conversation is 10-20 turns;
// 60/min still allows fast clicking through error retries.
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userKey,
  message: { error: 'Too many AI requests. Please wait a moment and try again.' },
})

// General API (CRUD on goals/programs/entries). 300/min per user.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userKey,
  message: { error: 'Too many requests. Please slow down.' },
})

module.exports = { aiLimiter, generalLimiter }
