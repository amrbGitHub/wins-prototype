<script setup>
import { ref } from 'vue'
import { useAuth } from '../composables/useAuth.js'

const { signIn, signUp } = useAuth()

const mode     = ref('signin')  // 'signin' | 'signup'
const email    = ref('')
const password = ref('')
const loading  = ref(false)
const errorMsg = ref('')
const infoMsg  = ref('')

async function submit() {
  errorMsg.value = ''
  infoMsg.value  = ''
  loading.value  = true
  try {
    if (mode.value === 'signup') {
      await signUp(email.value, password.value)
      infoMsg.value = 'Account created! You can now sign in.'
      mode.value = 'signin'
    } else {
      await signIn(email.value, password.value)
      // onAuthStateChange in useAuth.js updates user → App.vue renders main layout
    }
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div
    class="min-h-screen flex items-center justify-center px-4
           bg-[radial-gradient(90%_70%_at_15%_0%,rgba(251,191,36,0.20),transparent_55%),radial-gradient(80%_60%_at_85%_0%,rgba(244,63,94,0.16),transparent_60%),linear-gradient(to_bottom,#fff,#fff)]"
  >
    <div class="w-full max-w-sm rounded-3xl border border-slate-200 bg-white shadow-sm p-8 space-y-6">

      <!-- Logo -->
      <div class="text-center">
        <div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-rose-600 to-amber-400 text-white shadow-sm">
          <span class="text-xl font-bold">W</span>
        </div>
        <h1 class="text-lg font-semibold text-slate-900">Celebrating Wins</h1>
        <p class="text-sm text-slate-500 mt-1">Make training impact visible — without extra friction</p>
      </div>

      <!-- Mode toggle -->
      <div class="flex rounded-2xl border border-slate-200 overflow-hidden">
        <button
          @click="mode = 'signin'; errorMsg = ''; infoMsg = ''"
          class="flex-1 py-2 text-sm font-medium transition"
          :class="mode === 'signin' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'"
        >
          Sign in
        </button>
        <button
          @click="mode = 'signup'; errorMsg = ''; infoMsg = ''"
          class="flex-1 py-2 text-sm font-medium transition"
          :class="mode === 'signup' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'"
        >
          Sign up
        </button>
      </div>

      <!-- Form -->
      <form @submit.prevent="submit" class="space-y-4">
        <div>
          <label class="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</label>
          <input
            v-model="email"
            type="email"
            required
            autocomplete="email"
            class="mt-1 block w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm shadow-sm
                   focus:border-rose-300 focus:ring-4 focus:ring-rose-100 focus:outline-none"
          />
        </div>
        <div>
          <label class="text-xs font-semibold uppercase tracking-wide text-slate-500">Password</label>
          <input
            v-model="password"
            type="password"
            required
            :autocomplete="mode === 'signup' ? 'new-password' : 'current-password'"
            class="mt-1 block w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm shadow-sm
                   focus:border-rose-300 focus:ring-4 focus:ring-rose-100 focus:outline-none"
          />
        </div>

        <div v-if="infoMsg" class="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {{ infoMsg }}
        </div>
        <div v-if="errorMsg" class="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {{ errorMsg }}
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="inline-flex w-full items-center justify-center gap-2 rounded-2xl
                 bg-gradient-to-r from-rose-600 to-amber-500 py-3 text-sm font-semibold text-white
                 shadow-sm transition hover:brightness-95 disabled:opacity-60"
        >
          <span v-if="loading" class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
          {{ mode === 'signup' ? 'Create account' : 'Sign in' }}
        </button>
      </form>
    </div>
  </div>
</template>
