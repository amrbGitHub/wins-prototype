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
app.use('/api/goals',       require('./routes/goals'))
app.use('/api/programs',    require('./routes/programs'))
app.use('/api/reflections', require('./routes/reflections'))
app.use('/api/profile',     require('./routes/profile'))
app.use('/api/elsie',       require('./routes/elsie'))
app.use('/api/lc/conversations', require('./routes/lc-conversations'))
app.use('/api/dev',         require('./routes/dev'))           // testing-only: clean-slate, etc.

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const { OLLAMA_BASE_URL, OLLAMA_MODEL } = require('./config')
  console.log(`Backend running on http://localhost:${PORT}`)
  console.log(`Ollama: ${OLLAMA_MODEL} @ ${OLLAMA_BASE_URL}`)
})
