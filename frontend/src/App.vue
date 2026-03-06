<script setup>
import { ref } from 'vue'
import { useAuth } from './composables/useAuth.js'
import Celebrate from './components/Celebrate.vue'
import Journal   from './components/Journal.vue'
import AuthPage  from './components/AuthPage.vue'

const { user, loading, signOut } = useAuth()
const currentView = ref('celebrate')
</script>

<template>
  <!-- Hydrating session from storage — prevents flash of login page for logged-in users -->
  <div v-if="loading" class="min-h-screen flex items-center justify-center bg-white">
    <span class="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600"></span>
  </div>

  <!-- Not authenticated -->
  <AuthPage v-else-if="!user" />

  <!-- Authenticated -->
  <div
    v-else
    class="min-h-screen text-slate-900
           bg-[radial-gradient(90%_70%_at_15%_0%,rgba(251,191,36,0.20),transparent_55%),radial-gradient(80%_60%_at_85%_0%,rgba(244,63,94,0.16),transparent_60%),linear-gradient(to_bottom,#fff,#fff)]"
  >
    <!-- Header -->
    <header class="sticky top-0 z-10 border-b border-slate-200/60 bg-white/80 backdrop-blur">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <!-- Logo -->
        <div class="flex items-center gap-3">
          <div class="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-rose-600 to-amber-400 text-white shadow-sm">
            <span class="text-lg font-bold">W</span>
          </div>
          <div>
            <h1 class="text-lg font-semibold leading-tight">Celebrating Wins</h1>
            <p class="text-sm text-slate-500 -mt-0.5">Make training impact visible—without extra friction</p>
          </div>
        </div>

        <!-- Desktop nav tabs -->
        <div class="hidden sm:flex rounded-full border border-slate-200 bg-slate-50 p-0.5">
          <button
            @click="currentView = 'celebrate'"
            class="rounded-full px-4 py-1.5 text-xs font-medium transition"
            :class="currentView === 'celebrate' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'"
          >
            Celebrate
          </button>
          <button
            @click="currentView = 'journal'"
            class="rounded-full px-4 py-1.5 text-xs font-medium transition"
            :class="currentView === 'journal' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'"
          >
            Journal
          </button>
        </div>

        <!-- User info + sign out -->
        <div class="flex items-center gap-2">
          <span class="hidden sm:block text-xs text-slate-500 truncate max-w-[180px]">{{ user.email }}</span>
          <button
            @click="signOut"
            class="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium
                   text-slate-600 hover:bg-slate-50 transition shadow-sm"
          >
            Sign out
          </button>
        </div>
      </div>

      <!-- Mobile nav -->
      <div class="flex sm:hidden border-t border-slate-100">
        <button
          @click="currentView = 'celebrate'"
          class="flex-1 py-2 text-xs font-medium transition"
          :class="currentView === 'celebrate' ? 'text-rose-600 border-b-2 border-rose-500' : 'text-slate-500'"
        >
          Celebrate
        </button>
        <button
          @click="currentView = 'journal'"
          class="flex-1 py-2 text-xs font-medium transition"
          :class="currentView === 'journal' ? 'text-rose-600 border-b-2 border-rose-500' : 'text-slate-500'"
        >
          Journal
        </button>
      </div>
    </header>

    <!-- Views -->
    <Celebrate v-if="currentView === 'celebrate'" />
    <Journal   v-else />
  </div>
</template>
