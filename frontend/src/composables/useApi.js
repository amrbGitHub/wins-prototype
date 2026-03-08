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

  return { apiFetch, apiFetchPublic }
}
