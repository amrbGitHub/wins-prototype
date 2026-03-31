const { Router } = require('express')
const { OLLAMA_BASE_URL } = require('../config')

const router = Router()

// GET /api/health — returns Ollama reachability status
router.get('/', async (req, res) => {
  try {
    const resp = await fetch(`${OLLAMA_BASE_URL}/models`, {
      method: 'GET',
      headers: { 'ngrok-skip-browser-warning': 'true' },
      signal: AbortSignal.timeout(4000), // 4 s timeout — fast fail
    })
    res.json({ ollama: resp.ok ? 'online' : 'offline' })
  } catch {
    res.json({ ollama: 'offline' })
  }
})

module.exports = router
