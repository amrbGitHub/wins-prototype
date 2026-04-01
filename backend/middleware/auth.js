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
    req.userId = user.id
    next()
  } catch (err) {
    console.error('verifyToken error:', err.message)
    return res.status(401).json({ error: 'Invalid or expired token', detail: err.message })
  }
}

module.exports = { verifyToken }
