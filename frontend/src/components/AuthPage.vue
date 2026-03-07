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
    class="min-h-screen flex items-center justify-center px-4 py-8
           bg-gradient-to-br from-slate-50 via-white to-teal-50/30"
  >
    <!-- Background decoration -->
    <div class="fixed inset-0 overflow-hidden pointer-events-none">
      <div class="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-gradient-to-br from-[#0d5f6b]/5 to-transparent blur-3xl"></div>
      <div class="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-gradient-to-tr from-teal-500/5 to-transparent blur-3xl"></div>
    </div>

    <div class="relative w-full max-w-sm overflow-hidden rounded-3xl border border-slate-200/60 bg-white/80 shadow-xl shadow-slate-200/30 p-8 space-y-6 backdrop-blur-sm">

      <!-- Gradient background -->
      <div class="absolute inset-0 bg-gradient-to-br from-white via-slate-50/50 to-teal-50/20"></div>

      <!-- Logo -->
      <div class="relative text-center">
        <div class="relative mx-auto mb-4 w-16 h-16">
          <div class="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#0d5f6b] to-[#0a4a54] shadow-xl shadow-[#0d5f6b]/25 flex items-center justify-center">
            <span class="text-2xl font-bold text-white">W</span>
          </div>
          <div class="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-white bg-emerald-400 shadow-sm"></div>
        </div>
        <h1 class="text-xl font-bold text-slate-900">Celebrating Wins</h1>
        <p class="text-sm text-slate-500 mt-1.5 font-medium">Make training impact visible</p>
      </div>

      <!-- Mode toggle -->
      <div class="relative flex rounded-2xl border border-slate-200/60 bg-slate-50/50 p-1 shadow-inner">
        <button
          @click="mode = 'signin'; errorMsg = ''; infoMsg = ''"
          class="flex-1 py-2.5 text-sm font-bold rounded-xl transition-all duration-200"
          :class="mode === 'signin' ? 'bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] text-white shadow-md shadow-[#0d5f6b]/20' : 'text-slate-500 hover:text-slate-700'"
        >
          Sign in
        </button>
        <button
          @click="mode = 'signup'; errorMsg = ''; infoMsg = ''"
          class="flex-1 py-2.5 text-sm font-bold rounded-xl transition-all duration-200"
          :class="mode === 'signup' ? 'bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] text-white shadow-md shadow-[#0d5f6b]/20' : 'text-slate-500 hover:text-slate-700'"
        >
          Sign up
        </button>
      </div>

      <!-- Form -->
      <form @submit.prevent="submit" class="relative space-y-4">
        <div>
          <label class="text-xs font-bold uppercase tracking-wider text-slate-400">Email</label>
          <input
            v-model="email"
            type="email"
            required
            autocomplete="email"
            class="mt-2 block w-full rounded-2xl border border-slate-200/60 bg-white/80 px-4 py-3 text-sm shadow-sm
                   focus:border-[#0d5f6b]/40 focus:ring-4 focus:ring-[#0d5f6b]/10 focus:outline-none transition"
          />
        </div>
        <div>
          <label class="text-xs font-bold uppercase tracking-wider text-slate-400">Password</label>
          <input
            v-model="password"
            type="password"
            required
            :autocomplete="mode === 'signup' ? 'new-password' : 'current-password'"
            class="mt-2 block w-full rounded-2xl border border-slate-200/60 bg-white/80 px-4 py-3 text-sm shadow-sm
                   focus:border-[#0d5f6b]/40 focus:ring-4 focus:ring-[#0d5f6b]/10 focus:outline-none transition"
          />
        </div>

        <div v-if="infoMsg" class="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-sm text-emerald-800 font-medium">
          {{ infoMsg }}
        </div>
        <div v-if="errorMsg" class="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-sm text-rose-800 font-medium">
          {{ errorMsg }}
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="relative inline-flex w-full items-center justify-center gap-2.5 rounded-2xl
                 bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] hover:from-[#0b5060] hover:to-[#0a4a54] py-3.5 text-sm font-bold text-white
                 shadow-lg shadow-[#0d5f6b]/25 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
        >
          <span v-if="loading" class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
          {{ mode === 'signup' ? 'Create account' : 'Sign in' }}
        </button>
      </form>
    </div>
  </div>
</template>
