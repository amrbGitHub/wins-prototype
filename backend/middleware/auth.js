const { supabase } = require('../config')

async function verifyToken(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' })
  }
  try {
    const { data: { user }, error } = await supabase.auth.getUser(header.slice(7))
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token', detail: error?.message })
    }
    req.userId    = user.id
    req.userEmail = user.email
    next()
  } catch (err) {
    console.error('verifyToken error:', err.message)
    return res.status(401).json({ error: 'Invalid or expired token', detail: err.message })
  }
}

// Admin email allowlist from env. Any account whose Supabase auth email
// matches one of these is treated as an admin regardless of the profiles.role
// column. This is the source of truth — the DB column is just a cache that
// the profile fetcher keeps in sync. Lets us promote a new admin by editing
// one env var, no SQL needed.
function adminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}
function isAdminEmail(email) {
  if (!email) return false
  return adminEmails().includes(String(email).toLowerCase())
}

// requireAdmin — chain after verifyToken. Email allowlist is authoritative;
// profiles.role is the cached mirror.
async function requireAdmin(req, res, next) {
  try {
    if (isAdminEmail(req.userEmail)) return next()
    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', req.userId)
      .maybeSingle()
    if (error) return res.status(500).json({ error: error.message })
    if (data?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }
    next()
  } catch (err) {
    console.error('requireAdmin error:', err.message)
    return res.status(500).json({ error: 'Admin check failed', detail: err.message })
  }
}

module.exports = { verifyToken, requireAdmin, isAdminEmail }
