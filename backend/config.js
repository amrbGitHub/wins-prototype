const path = require('path')
// Explicitly resolve .env relative to this file, not process.cwd()
require('dotenv').config({ path: path.join(__dirname, '.env') })

const { createClient } = require('@supabase/supabase-js')

// ── Server ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8787

// ── CORS ──────────────────────────────────────────────────────────────────────
// Localhost dev ports are always allowed — harmless in production, essential locally
const ALLOWED_ORIGINS = [
  'http://localhost:5173',  // Vite dev server
  'http://localhost:4173',  // Vite preview
  ...(process.env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean),
]

function originAllowed(origin) {
  if (!origin) return true // curl / server-to-server
  const o = origin.replace(/\/$/, '')
  return ALLOWED_ORIGINS.some(pattern =>
    pattern.startsWith('*.') ? o.endsWith(pattern.slice(1)) : o === pattern
  )
}

// ── Supabase ──────────────────────────────────────────────────────────────────
// Service-role client — bypasses RLS; server-side only, never exposed to clients
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ── Ollama ────────────────────────────────────────────────────────────────────
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1'
const OLLAMA_MODEL    = process.env.OLLAMA_MODEL    || 'llama3.2'

module.exports = { PORT, supabase, originAllowed, OLLAMA_BASE_URL, OLLAMA_MODEL }
