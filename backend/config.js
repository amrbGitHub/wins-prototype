const path = require('path')
// Explicitly resolve .env relative to this file, not process.cwd().
// `override: true` makes .env values win over pre-existing shell env vars.
// Without it, an empty `ANTHROPIC_API_KEY=` set somewhere in your shell
// profile silently shadows the real key in .env and dotenv quietly skips it.
// For a dev backend, .env is the source of truth — shell overrides have
// caused more debugging time than they've ever saved.
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true })

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

// Cybersec audit Finding #2: we used to unconditionally allow requests with
// no Origin header (curl, server-to-server). That's a blanket CORS bypass
// for any tool that omits the header. Now: in production, no Origin = reject.
// Dev still allows it so local curl/Postman testing keeps working.
function originAllowed(origin) {
  if (!origin) return process.env.NODE_ENV !== 'production'
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
