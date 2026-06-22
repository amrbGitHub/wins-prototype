// Cheap JWT `sub` extraction (no signature check). Used by rate-limit
// keying and request-log keying to identify a caller at the global
// middleware layer, before any route's verifyToken has run.
//
// Safe to use without verification: a forged sub still has to survive
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

module.exports = { subFromAuthHeader }
