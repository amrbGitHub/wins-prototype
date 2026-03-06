import { ref, readonly } from 'vue'
import { supabase } from '../lib/supabase.js'

// Module-level state — shared singleton across all components
const user    = ref(null)
const session = ref(null)
const loading = ref(true)  // true while hydrating from storage on startup

// Hydrate session from localStorage (Supabase persists it automatically)
supabase.auth.getSession().then(({ data }) => {
  session.value = data.session
  user.value    = data.session?.user ?? null
  loading.value = false
})

// Keep state in sync with auth events (login, logout, token refresh)
supabase.auth.onAuthStateChange((_event, newSession) => {
  session.value = newSession
  user.value    = newSession?.user ?? null
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

export function useAuth() {
  return {
    user:    readonly(user),
    session: readonly(session),
    loading: readonly(loading),
    signUp,
    signIn,
    signOut,
    getAccessToken,
  }
}
