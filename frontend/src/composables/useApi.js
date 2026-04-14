import { useAuth } from './useAuth.js'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

export function useApi() {
  const { getAccessToken } = useAuth()

  // Authenticated fetch — attaches Bearer token, prefixes BASE_URL
  async function apiFetch(path, options = {}) {
    const token = getAccessToken()
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
      },
    })
    if (!res.ok) throw new Error(await res.text())
    if (res.status === 204) return null
    return res.json()
  }

  // Unauthenticated fetch — for AI endpoints that don't require a token
  async function apiFetchPublic(path, options = {}) {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
    if (!res.ok) throw new Error(await res.text())
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
        try { yield JSON.parse(line.slice(6)) } catch {}
      }
    }
  }

  // Authenticated SSE stream
  async function* apiStream(path, options = {}) {
    const token = getAccessToken()
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...options.headers },
    })
    if (!res.ok) throw new Error(await res.text())
    yield* _readSSE(res)
  }

  // Unauthenticated SSE stream — for AI chat endpoints
  async function* apiStreamPublic(path, options = {}) {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    })
    if (!res.ok) throw new Error(await res.text())
    yield* _readSSE(res)
  }

  return { apiFetch, apiFetchPublic, apiStream, apiStreamPublic }
}
