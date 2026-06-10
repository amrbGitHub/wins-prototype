// LLM provider configuration with a thin in-memory cache.
//
// Config lives in the singleton row `app_config[key='llm']` in Supabase.
// The API key is encrypted at rest using PSEUDONYM_ENCRYPTION_KEY (the
// existing master). Plain fields (base URL, model ids, temperature, max
// tokens) live in cleartext inside the JSON value.
//
// Env vars (ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY, ANTHROPIC_MODEL,
// SUMMARY_MODEL, ANTHROPIC_MAX_TOKENS, ANTHROPIC_TEMPERATURE) are used as
// fallback defaults — if no DB row exists yet, we serve env values so the
// app keeps working on fresh deploys before any admin save.

const crypto = require('node:crypto')
const { supabase } = require('../config')

const CONFIG_KEY = 'llm'

// ── Encryption helpers (server-wide, not per-user) ──────────────────────────
function getMasterKey() {
  const b64 = process.env.PSEUDONYM_ENCRYPTION_KEY
  if (!b64) {
    throw new Error(
      'PSEUDONYM_ENCRYPTION_KEY is not set in env. Required for encrypting the LLM provider API key.'
    )
  }
  const buf = Buffer.from(b64, 'base64')
  if (buf.length !== 32) {
    throw new Error(`PSEUDONYM_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length}).`)
  }
  return buf
}

// HKDF with a fixed info string distinct from the per-user info, so the
// server-config key is cryptographically independent from any user key
// derived from the same master.
function deriveSystemKey() {
  const salt = Buffer.from('wins-prototype/system-config/v1', 'utf8')
  const info = Buffer.from('app_config', 'utf8')
  return Buffer.from(crypto.hkdfSync('sha256', getMasterKey(), salt, info, 32))
}

function encryptSystem(plaintext) {
  if (!plaintext) return null
  const key = deriveSystemKey()
  const iv  = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, ct, tag]).toString('base64')
}

function decryptSystem(b64) {
  if (!b64) return null
  const buf = Buffer.from(b64, 'base64')
  if (buf.length < 12 + 16) throw new Error('llmConfig: ciphertext too short')
  const key = deriveSystemKey()
  const iv  = buf.subarray(0, 12)
  const tag = buf.subarray(buf.length - 16)
  const ct  = buf.subarray(12, buf.length - 16)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

// ── In-memory cache ─────────────────────────────────────────────────────────
let _cache = null
let _cacheLoadedAt = 0
const CACHE_TTL_MS = 60_000  // stale-after-1min; admin saves invalidate immediately

function envDefaults() {
  return {
    baseUrl:      process.env.ANTHROPIC_BASE_URL || '',
    chatModel:    process.env.ANTHROPIC_MODEL    || 'claude-haiku-4-5-20251001',
    summaryModel: process.env.SUMMARY_MODEL      || process.env.ANTHROPIC_MODEL || '',
    apiKey:       process.env.ANTHROPIC_API_KEY  || '',
    temperature:  Number(process.env.ANTHROPIC_TEMPERATURE || 0.4),
    maxTokens:    Number(process.env.ANTHROPIC_MAX_TOKENS  || 1024),
  }
}

function invalidate() { _cache = null; _cacheLoadedAt = 0 }

// Read config: DB → env fallback. Cached for CACHE_TTL_MS. Returns the full
// resolved config including the plaintext API key (caller is the backend —
// the key never leaves the server).
async function getLlmConfig() {
  if (_cache && Date.now() - _cacheLoadedAt < CACHE_TTL_MS) return _cache
  const defaults = envDefaults()
  try {
    const { data, error } = await supabase
      .from('app_config').select('value').eq('key', CONFIG_KEY).maybeSingle()
    if (error && error.code !== 'PGRST116') throw error
    const v = data?.value || {}
    const apiKey = v.apiKeyEnc ? decryptSystem(v.apiKeyEnc) : defaults.apiKey
    _cache = {
      baseUrl:      v.baseUrl      ?? defaults.baseUrl,
      chatModel:    v.chatModel    ?? defaults.chatModel,
      summaryModel: v.summaryModel ?? defaults.summaryModel,
      apiKey:       apiKey || '',
      temperature:  typeof v.temperature === 'number' ? v.temperature : defaults.temperature,
      maxTokens:    typeof v.maxTokens   === 'number' ? v.maxTokens   : defaults.maxTokens,
    }
    _cacheLoadedAt = Date.now()
    return _cache
  } catch (err) {
    // If the table doesn't exist yet (migration not applied) or any other
    // DB error, fall back to env so the app keeps working.
    console.warn('[llmConfig] DB read failed, falling back to env:', err.message)
    _cache = defaults
    _cacheLoadedAt = Date.now()
    return _cache
  }
}

// Write config. Pass any subset of the fields. apiKey semantics:
//   - undefined → keep existing
//   - null      → clear stored key (revert to env fallback)
//   - string    → encrypt and store
async function setLlmConfig(patch) {
  const { data: existing } = await supabase
    .from('app_config').select('value').eq('key', CONFIG_KEY).maybeSingle()
  const prev = existing?.value || {}
  const next = { ...prev }

  if (patch.baseUrl      !== undefined) next.baseUrl      = patch.baseUrl      || ''
  if (patch.chatModel    !== undefined) next.chatModel    = patch.chatModel    || ''
  if (patch.summaryModel !== undefined) next.summaryModel = patch.summaryModel || ''
  if (typeof patch.temperature === 'number') next.temperature = patch.temperature
  if (typeof patch.maxTokens   === 'number') next.maxTokens   = patch.maxTokens

  if (patch.apiKey === null) {
    delete next.apiKeyEnc
  } else if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
    next.apiKeyEnc = encryptSystem(patch.apiKey.trim())
  }

  const { error } = await supabase
    .from('app_config')
    .upsert({ key: CONFIG_KEY, value: next, updated_at: new Date().toISOString() },
            { onConflict: 'key' })
  if (error) throw error
  invalidate()
}

module.exports = { getLlmConfig, setLlmConfig, invalidate }
