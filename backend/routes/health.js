const { Router } = require('express')
const { getLlmConfig } = require('../lib/llmConfig')

const router = Router()

// GET /api/health — LLM provider readiness.
// We don't ping the provider here (costs money, adds latency on every page
// load). "online" means: a provider is selected AND an API key is configured.
// A real outage during a chat call will surface its own error.
router.get('/', async (req, res) => {
  try {
    const cfg = await getLlmConfig()
    const ready = !!(cfg.providerType && cfg.apiKey)
    res.json({
      llm:      ready ? 'online' : 'offline',
      provider: cfg.providerType || null,
      model:    cfg.chatModel    || null,
    })
  } catch {
    res.json({ llm: 'offline', provider: null, model: null })
  }
})

module.exports = router
