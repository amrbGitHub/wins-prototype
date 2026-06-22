// Append-only per-user write log. Hooked as global middleware; runs once
// per request via res.on('finish') so the row gets the final status code
// that was actually sent to the client.
//
// Scope: authenticated writes only (POST/PATCH/PUT/DELETE). We resolve
// the user identity from the JWT `sub` claim (no signature check — the
// downstream verifyToken does that). Why pre-auth resolution: when the
// rate limiter rejects a burst with 429, route handlers never run, so
// req.userId from verifyToken would be undefined — and a missed 429
// log entry is exactly the data point an admin needs.
//
// Best-effort: a recording failure must never break the user-facing
// response. We've already responded by the time this fires; the supabase
// insert is fire-and-forget with a console warning on error.

const { supabase } = require('../config')
const { subFromAuthHeader } = require('./jwtSub')

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

function requestLog(req, res, next) {
  // Snapshot the caller identity now, before any downstream handler clears
  // or rewrites req.headers. Prefer the verifyToken-set req.userId if it
  // happens to be available, but for 429s and other pre-auth rejections
  // the JWT decode is our only signal.
  const callerId = req.userId || subFromAuthHeader(req.headers.authorization)

  res.on('finish', () => {
    if (!WRITE_METHODS.has(req.method)) return
    if (!callerId) return  // anonymous writes — not interesting for the abuse panel
    const route = String(req.originalUrl || req.url || '').slice(0, 200)
    supabase.from('request_log').insert({
      user_id:  callerId,
      method:   req.method,
      route,
      status:   res.statusCode,
    }).then(({ error }) => {
      if (error) console.warn('[request-log] insert failed (non-fatal):', error.message)
    }).catch(err => {
      console.warn('[request-log] insert threw (non-fatal):', err.message)
    })
  })
  next()
}

module.exports = { requestLog }
