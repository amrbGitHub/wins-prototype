const express = require('express')
const cors    = require('cors')
const helmet  = require('helmet')
const { PORT, originAllowed } = require('./config')
const { errorHandler } = require('./middleware/errorHandler')
const { aiLimiter, generalLimiter } = require('./middleware/rateLimit')

const app = express()

// Behind Render's proxy: trust the X-Forwarded-* headers so req.ip reflects
// the real client and rate-limit keying isn't a single shared upstream IP.
app.set('trust proxy', 1)

// ── Security headers ──────────────────────────────────────────────────────────
// Cybersec audit Findings #6, #7, #9: CSP, X-Frame-Options, X-Content-Type-
// Options, plus a sensible default set. Helmet manages all of these from one
// place. CSP is API-scoped (we don't render HTML here) so a relatively strict
// default-src 'none' is fine; if we ever serve frontend assets from this
// origin we'll need to relax it.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,   // not needed for a pure JSON API
  crossOriginResourcePolicy: { policy: 'same-site' },
  hsts: { maxAge: 15552000, includeSubDomains: true },
}))

// Cache-Control for API responses: every JSON payload here is user-specific,
// so we never want browsers, proxies, or shared-device sessions to retain it.
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  res.setHeader('Pragma', 'no-cache')
  next()
})

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, cb) =>
    originAllowed(origin) ? cb(null, true) : cb(new Error(`CORS: origin ${origin} not allowed`)),
}))
app.use(express.json({ limit: '1mb' }))

// General per-user rate limit covers everything not opted-in to the
// heavier aiLimiter below.
app.use(generalLimiter)

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/health',      require('./routes/health'))
app.use('/api/entries',     require('./routes/entries'))
app.use('/api',             aiLimiter, require('./routes/wins'))   // /api/analyze, /api/draft, etc. — LLM-backed
app.use('/api/goals',       require('./routes/goals'))
app.use('/api/programs',    require('./routes/programs'))
app.use('/api/reflections', aiLimiter, require('./routes/reflections'))
app.use('/api/profile',     require('./routes/profile'))
app.use('/api/elsie',       aiLimiter, require('./routes/elsie'))
app.use('/api/tts',         aiLimiter, require('./routes/tts'))    // ElevenLabs proxy
app.use('/api/lc/conversations', require('./routes/lc-conversations'))
app.use('/api/account',     require('./routes/account'))
app.use('/api/admin',       require('./routes/admin'))

// ── Global error handler (must be last) ───────────────────────────────────────
// Cybersec audit Finding #4: returns generic messages to the client, logs
// full detail server-side.
app.use(errorHandler)

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`Backend running on http://localhost:${PORT}`)
  try {
    const { getLlmConfig } = require('./lib/llmConfig')
    const cfg = await getLlmConfig()
    console.log(`LLM: ${cfg.providerType || '(none)'} / chat=${cfg.chatModel || '(no model)'} fast=${cfg.summaryModel || '(unset → falls back to chat)'}${cfg.apiKey ? '' : ' [no API key]'}`)
    if (cfg.chatModel && cfg.summaryModel && cfg.chatModel === cfg.summaryModel) {
      // Summary updater + analyzers (wins/goals/reflections/titles) are
      // billed to the chat model. Set SUMMARY_MODEL (or the admin LLM
      // config's fast-model slot) to a cheaper sibling to cut cost.
      console.warn('[LLM] WARN: summaryModel === chatModel — bounded JSON tasks are paying chat-model prices')
    }
  } catch (err) {
    console.warn('LLM config unavailable at boot:', err.message)
  }
})
