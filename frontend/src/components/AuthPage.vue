<script setup>
import { ref } from 'vue'
import { useAuth } from '../composables/useAuth.js'
import { Star, Sparkles, Trophy, Users } from 'lucide-vue-next'

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
  <div class="flex min-h-screen">

    <!-- ── Left panel: brand / illustration (hidden on mobile) ──────────────────── -->
    <div
      class="relative hidden flex-col justify-between overflow-hidden p-10 lg:flex lg:w-[52%]"
      style="background:linear-gradient(145deg,#0b1a1c 0%,#0d5f6b 45%,#0ea5e9 100%)"
    >
      <!-- Decorative circles -->
      <div class="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/5 blur-3xl"></div>
      <div class="pointer-events-none absolute -bottom-24 -left-24 h-96 w-96 rounded-full bg-cyan-400/10 blur-3xl"></div>
      <div class="pointer-events-none absolute right-0 top-1/2 h-48 w-48 -translate-y-1/2 rounded-full bg-teal-300/10 blur-2xl"></div>

      <!-- Logo -->
      <div class="relative flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 shadow-lg ring-1 ring-white/20">
          <span class="text-lg font-extrabold text-white">W</span>
        </div>
        <span class="text-lg font-bold text-white tracking-tight">Celebrating Wins</span>
      </div>

      <!-- Center hero text -->
      <div class="relative space-y-8">
        <div class="space-y-4">
          <h2 class="text-4xl font-extrabold leading-tight text-white">
            Make training<br/>impact <span class="text-cyan-300">visible.</span>
          </h2>
          <p class="max-w-xs text-base text-teal-100/80 leading-relaxed">
            Track learner wins, celebrate progress, and prove your L&D impact — all in one beautiful place.
          </p>
        </div>

        <!-- Feature pills -->
        <div class="flex flex-col gap-3">
          <div class="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3 backdrop-blur-sm ring-1 ring-white/10">
            <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-400/20">
              <Star class="h-4 w-4 text-cyan-300" />
            </div>
            <span class="text-sm font-medium text-white/90">AI-extracted wins from journal entries</span>
          </div>
          <div class="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3 backdrop-blur-sm ring-1 ring-white/10">
            <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-400/20">
              <Trophy class="h-4 w-4 text-teal-300" />
            </div>
            <span class="text-sm font-medium text-white/90">Monthly goal planning with AI coach</span>
          </div>
          <div class="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3 backdrop-blur-sm ring-1 ring-white/10">
            <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-400/20">
              <Users class="h-4 w-4 text-violet-300" />
            </div>
            <span class="text-sm font-medium text-white/90">Celebration messages for your team</span>
          </div>
        </div>
      </div>

      <!-- Bottom quote -->
      <div class="relative rounded-xl bg-white/10 px-5 py-4 backdrop-blur-sm ring-1 ring-white/10">
        <Sparkles class="mb-2 h-4 w-4 text-cyan-300" />
        <p class="text-sm italic text-white/80">"Every win, no matter how small, deserves to be seen."</p>
      </div>
    </div>

    <!-- ── Right panel: auth form ─────────────────────────────────────────────── -->
    <div class="flex flex-1 flex-col items-center justify-center px-6 py-12" style="background:var(--page-bg)">

      <!-- Mobile-only logo -->
      <div class="mb-8 flex flex-col items-center gap-2 lg:hidden">
        <div class="flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg" style="background:linear-gradient(135deg,#0d5f6b,#0a4a54)">
          <span class="text-2xl font-extrabold text-white">W</span>
        </div>
        <span class="text-lg font-bold text-slate-800">Celebrating Wins</span>
      </div>

      <div class="w-full max-w-sm space-y-6">
        <!-- Heading -->
        <div class="space-y-1">
          <h1 class="text-2xl font-extrabold text-slate-900">
            {{ mode === 'signup' ? 'Create your account' : 'Welcome back' }}
          </h1>
          <p class="text-sm text-slate-500">
            {{ mode === 'signup' ? 'Start tracking wins in seconds.' : 'Sign in to continue your journey.' }}
          </p>
        </div>

        <!-- Mode toggle -->
        <div class="flex overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          <button
            @click="mode = 'signin'; errorMsg = ''; infoMsg = ''"
            class="flex-1 rounded-lg py-2.5 text-sm font-bold transition-all duration-200"
            :class="mode === 'signin'
              ? 'bg-gradient-to-r from-[#0d5f6b] to-[#0e7888] text-white shadow-md'
              : 'text-slate-500 hover:text-slate-700'"
          >Sign in</button>
          <button
            @click="mode = 'signup'; errorMsg = ''; infoMsg = ''"
            class="flex-1 rounded-lg py-2.5 text-sm font-bold transition-all duration-200"
            :class="mode === 'signup'
              ? 'bg-gradient-to-r from-[#0d5f6b] to-[#0e7888] text-white shadow-md'
              : 'text-slate-500 hover:text-slate-700'"
          >Sign up</button>
        </div>

        <!-- Form -->
        <form @submit.prevent="submit" class="space-y-4">
          <div>
            <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-400">Email</label>
            <input
              v-model="email"
              type="email"
              required
              autocomplete="email"
              placeholder="you@example.com"
              class="input"
            />
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-400">Password</label>
            <input
              v-model="password"
              type="password"
              required
              :autocomplete="mode === 'signup' ? 'new-password' : 'current-password'"
              placeholder="••••••••"
              class="input"
            />
          </div>

          <div v-if="infoMsg" class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            {{ infoMsg }}
          </div>
          <div v-if="errorMsg" class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
            {{ errorMsg }}
          </div>

          <button
            type="submit"
            :disabled="loading"
            class="btn btn-primary w-full justify-center rounded-xl py-3 text-sm disabled:opacity-60"
          >
            <span v-if="loading" class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
            {{ loading ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in' }}
          </button>
        </form>

        <p class="text-center text-xs text-slate-400">
          {{ mode === 'signin' ? "Don't have an account?" : 'Already have an account?' }}
          <button
            @click="mode = mode === 'signin' ? 'signup' : 'signin'; errorMsg = ''; infoMsg = ''"
            class="font-semibold text-[#0d5f6b] hover:underline"
          >
            {{ mode === 'signin' ? 'Sign up free' : 'Sign in' }}
          </button>
        </p>
      </div>
    </div>

  </div>
</template>
