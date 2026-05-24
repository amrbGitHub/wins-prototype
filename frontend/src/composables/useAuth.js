import { ref, readonly } from 'vue'
import { supabase } from '../lib/supabase.js'

// Module-level state — shared singleton across all components
const user    = ref(null)
const session = ref(null)
const loading = ref(true)  // true while hydrating from storage on startup

// Multi-tab listeners. Subscribers are notified on SIGNED_OUT / TOKEN_REFRESHED
// so other parts of the app can re-fetch profile state, drop stale caches, etc.
const authListeners = new Set()
function notifyAuthListeners(event, newSession) {
  for (const fn of authListeners) {
    try { fn(event, newSession) } catch (e) { console.error('[useAuth] listener error:', e) }
  }
}

// Hydrate session from localStorage (Supabase persists it automatically)
supabase.auth.getSession().then(({ data }) => {
  session.value = data.session
  user.value    = data.session?.user ?? null
  loading.value = false
})

// Keep state in sync with auth events (login, logout, token refresh).
// Note: Supabase emits the same events on every tab via storage events, so
// signing out in tab A propagates to tab B without extra work.
supabase.auth.onAuthStateChange((event, newSession) => {
  session.value = newSession
  user.value    = newSession?.user ?? null
  notifyAuthListeners(event, newSession)
})

async function signUp(email, password) {
  const { error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
}

async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

// Always returns the current valid token (refreshed automatically by Supabase)
function getAccessToken() {
  return session.value?.access_token ?? null
}

// Register a listener for auth events. Returns an unsubscribe fn.
// `event` values: 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED'
function onAuthEvent(fn) {
  authListeners.add(fn)
  return () => authListeners.delete(fn)
}

export function useAuth() {
  return {
    user:    readonly(user),
    session: readonly(session),
    loading: readonly(loading),
    signUp,
    signIn,
    signOut,
    getAccessToken,
    onAuthEvent,
  }
}
