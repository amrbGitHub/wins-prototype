import { useAuth } from './useAuth.js'
import { supabase } from '../lib/supabase.js'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

// Track 401 cascades so we don't fire signOut() repeatedly during a burst.
let _signingOut = false
async function handleAuthFailure() {
  if (_signingOut) return
  _signingOut = true
  try { await supabase.auth.signOut() } catch { /* fine */ }
  setTimeout(() => { _signingOut = false }, 2000)
}

// Custom error class so callers can distinguish HTTP status codes (especially 401)
// from generic network errors. The `body` field holds whatever the server sent —
// usually JSON `{error: "..."}`, sometimes HTML when ngrok or a proxy intervened.
export class ApiError extends Error {
  constructor({ status, statusText, body, message }) {
    super(message || statusText || `HTTP ${status}`)
    this.name       = 'ApiError'
    this.status     = status
    this.statusText = statusText
    this.body       = body
  }
}

// Tries to parse `body` as JSON {error: "..."}, falls back to a clean string.
function deriveErrorMessage(rawBody, status) {
  if (!rawBody) return `HTTP ${status}`
  if (typeof rawBody !== 'string') return `HTTP ${status}`
  // Strip HTML so we don't toast "<html>...</html>" at the user
  if (rawBody.startsWith('<')) return `HTTP ${status} (server returned HTML — proxy or upstream error)`
  try {
    const parsed = JSON.parse(rawBody)
    if (parsed?.error) return parsed.error
  } catch { /* not JSON */ }
  return rawBody.length > 200 ? `HTTP ${status}` : rawBody
}

export function useApi() {
  const { getAccessToken } = useAuth()

  async function _fetch(path, options = {}, { authenticated = true } = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    }
    if (authenticated) {
      const token = getAccessToken()
      if (token) headers.Authorization = `Bearer ${token}`
    }
    const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      // 401 on an authenticated request = stale/expired token. Sign the user out
      // so the UI redirects to login instead of toasting cryptic errors at them.
      if (res.status === 401 && authenticated) {
        handleAuthFailure()
      }
      throw new ApiError({
        status:     res.status,
        statusText: res.statusText,
        body,
        message:    deriveErrorMessage(body, res.status),
      })
    }
    return res
  }

  // Authenticated JSON fetch — attaches Bearer token, prefixes BASE_URL.
  async function apiFetch(path, options = {}) {
    const res = await _fetch(path, options, { authenticated: true })
    if (res.status === 204) return null
    return res.json()
  }

  // Unauthenticated JSON fetch — for endpoints that genuinely don't need auth (e.g. health).
  async function apiFetchPublic(path, options = {}) {
    const res = await _fetch(path, options, { authenticated: false })
    if (res.status === 204) return null
    return res.json()
  }

  // Consume an SSE stream — yields parsed JSON objects from each `data:` line
  async function* _readSSE(res) {
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try { yield JSON.parse(line.slice(6)) } catch { /* skip malformed chunks */ }
      }
    }
  }

  // Authenticated SSE stream — pass options.signal (AbortSignal) for cancellation
  async function* apiStream(path, options = {}) {
    const res = await _fetch(path, options, { authenticated: true })
    yield* _readSSE(res)
  }

  // Unauthenticated SSE stream
  async function* apiStreamPublic(path, options = {}) {
    const res = await _fetch(path, options, { authenticated: false })
    yield* _readSSE(res)
  }

  return { apiFetch, apiFetchPublic, apiStream, apiStreamPublic }
}
