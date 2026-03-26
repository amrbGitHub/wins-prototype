<script setup>
import { ref } from 'vue'
import { useAuth } from './composables/useAuth.js'
import Celebrate from './components/Celebrate.vue'
import Journal   from './components/Journal.vue'
import Planner   from './components/Planner.vue'
import MyGoals   from './components/MyGoals.vue'
import AuthPage  from './components/AuthPage.vue'

const { user, loading, signOut } = useAuth()
const currentView = ref('celebrate')

const tabs = [
  { id: 'celebrate', label: 'Celebrate' },
  { id: 'journal',   label: 'Journal'   },
  { id: 'planner',   label: 'Planner'   },
  { id: 'goals',     label: 'My Goals'  },
]
</script>

<template>
  <!-- Hydrating session — prevents flash of login page for logged-in users -->
  <div v-if="loading" class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
    <div class="flex flex-col items-center gap-3">
      <div class="relative">
        <div class="h-12 w-12 rounded-2xl bg-gradient-to-br from-[#0d5f6b] to-[#0a4a54] shadow-lg shadow-[#0d5f6b]/20 flex items-center justify-center">
          <span class="text-xl font-bold text-white">W</span>
        </div>
        <span class="absolute inset-0 h-12 w-12 rounded-2xl bg-[#0d5f6b] animate-ping opacity-20"></span>
      </div>
      <span class="text-sm font-medium text-slate-500">Loading...</span>
    </div>
  </div>

  <!-- Not authenticated -->
  <AuthPage v-else-if="!user" />

  <!-- Authenticated -->
  <div v-else class="min-h-screen text-slate-900 bg-gradient-to-br from-slate-50 via-white to-teal-50/30">

    <!-- Header -->
    <header class="sticky top-0 z-10 border-b border-slate-200/60 bg-white/80 backdrop-blur-xl shadow-sm">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">

        <!-- Logo -->
        <div class="flex items-center gap-3">
          <div class="relative">
            <div class="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-[#0d5f6b] to-[#0a4a54] text-white shadow-lg shadow-[#0d5f6b]/25">
              <span class="text-lg font-bold">W</span>
            </div>
            <div class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-400"></div>
          </div>
          <div>
            <h1 class="text-lg font-bold bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] bg-clip-text text-transparent">Celebrating Wins</h1>
            <p class="text-sm text-slate-400 -mt-0.5 font-medium">Make training impact visible</p>
          </div>
        </div>

        <!-- Desktop nav -->
        <div class="hidden sm:flex rounded-2xl border border-slate-200/60 bg-slate-50/80 p-0.5 shadow-inner">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            @click="currentView = tab.id"
            class="rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200"
            :class="currentView === tab.id
              ? 'bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] text-white shadow-md shadow-[#0d5f6b]/20'
              : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'"
          >
            {{ tab.label }}
          </button>
        </div>

        <!-- User info + sign out -->
        <div class="flex items-center gap-3">
          <div class="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100/80">
            <div class="h-7 w-7 rounded-full bg-gradient-to-br from-[#0d5f6b] to-[#0a4a54] flex items-center justify-center text-white text-xs font-bold shadow-sm">
              {{ user.email[0].toUpperCase() }}
            </div>
            <span class="text-xs text-slate-600 font-medium truncate max-w-[150px]">{{ user.email }}</span>
          </div>
          <button
            @click="signOut"
            class="rounded-xl border border-slate-200/60 bg-white/80 px-4 py-2 text-sm font-medium
                   text-slate-600 hover:bg-gradient-to-r hover:from-rose-50 hover:to-orange-50 hover:border-rose-200 hover:text-rose-600 transition-all duration-200 shadow-sm"
          >
            Sign out
          </button>
        </div>
      </div>

      <!-- Mobile nav -->
      <div class="flex sm:hidden border-t border-slate-100/60 bg-white/50">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          @click="currentView = tab.id"
          class="flex-1 py-2.5 text-xs font-semibold transition-all duration-200"
          :class="currentView === tab.id
            ? 'text-[#0d5f6b] border-b-2 border-[#0d5f6b] bg-gradient-to-r from-teal-50/50 to-transparent'
            : 'text-slate-400'"
        >
          {{ tab.label }}
        </button>
      </div>
    </header>

    <!-- Views -->
    <Celebrate v-if="currentView === 'celebrate'" />
    <Journal   v-else-if="currentView === 'journal'" />
    <Planner   v-else-if="currentView === 'planner'" @go-to-goals="currentView = 'goals'" />
    <MyGoals   v-else-if="currentView === 'goals'" />

  </div>
</template>
