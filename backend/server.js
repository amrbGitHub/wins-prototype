const express = require('express')
const cors    = require('cors')
const { PORT, originAllowed } = require('./config')

const app = express()

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, cb) =>
    originAllowed(origin) ? cb(null, true) : cb(new Error(`CORS: origin ${origin} not allowed`)),
}))
app.use(express.json({ limit: '1mb' }))

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/health',      require('./routes/health'))
app.use('/api/entries',     require('./routes/entries'))
app.use('/api',             require('./routes/wins'))        // /api/analyze, /api/draft, etc.
app.use('/api/planner',     require('./routes/planner'))
app.use('/api/goals',       require('./routes/goals'))
app.use('/api/reflections', require('./routes/reflections'))

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const { OLLAMA_BASE_URL, OLLAMA_MODEL } = require('./config')
  console.log(`Backend running on http://localhost:${PORT}`)
  console.log(`Ollama: ${OLLAMA_MODEL} @ ${OLLAMA_BASE_URL}`)
})
