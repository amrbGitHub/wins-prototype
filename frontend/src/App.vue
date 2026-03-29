<script setup>
import { ref, watch } from 'vue'
import { useAuth } from './composables/useAuth.js'
import { useApi }  from './composables/useApi.js'
import Celebrate   from './components/Celebrate.vue'
import Journal     from './components/Journal.vue'
import Planner     from './components/Planner.vue'
import MyGoals     from './components/MyGoals.vue'
import Reflections from './components/Reflections.vue'
import ReviewModal from './components/ReviewModal.vue'
import AuthPage    from './components/AuthPage.vue'

const { user, loading, signOut } = useAuth()
const { apiFetch } = useApi()

const currentView = ref('celebrate')

const tabs = [
  { id: 'celebrate',   label: 'Celebrate'   },
  { id: 'journal',     label: 'Journal'     },
  { id: 'planner',     label: 'Planner'     },
  { id: 'goals',       label: 'My Goals'    },
  { id: 'reflections', label: 'Reflections' },
]

// ── Weekly review notification ────────────────────────────────────────────────
const showReviewBanner = ref(false)
const showReviewModal  = ref(false)
const reviewGoals      = ref([])
const reviewMonth      = ref('')

// Run the check once the user is confirmed logged-in
watch(user, async (u) => {
  if (u) await checkReviewDue()
}, { immediate: true })

async function checkReviewDue() {
  const currentMonth = new Date().toISOString().slice(0, 7)

  // Respect snooze — don't show if dismissed within the last 7 days
  const snoozed = localStorage.getItem(`wins-review-snoozed-${currentMonth}`)
  if (snoozed) {
    const daysSince = (Date.now() - new Date(snoozed).getTime()) / (1000 * 60 * 60 * 24)
    if (daysSince < 7) return
  }

  try {
    const goals = await apiFetch(`/api/goals?month=${currentMonth}`)
    if (!goals?.length) return

    // Only prompt if the oldest goal is at least 7 days old
    const oldestCreated = Math.min(...goals.map(g => g.createdAt))
    const daysSinceSet  = (Date.now() - oldestCreated) / (1000 * 60 * 60 * 24)
    if (daysSinceSet < 7) return

    reviewGoals.value      = goals
    reviewMonth.value      = currentMonth
    showReviewBanner.value = true
  } catch {
    // Silently ignore — notification is non-critical
  }
}

function snoozeReview() {
  localStorage.setItem(`wins-review-snoozed-${reviewMonth.value}`, new Date().toISOString())
  showReviewBanner.value = false
}

function openReviewModal() {
  showReviewBanner.value = false
  showReviewModal.value  = true
}

function onReflectionSaved() {
  showReviewModal.value = false
  // Snooze so the banner doesn't reappear this week
  localStorage.setItem(`wins-review-snoozed-${reviewMonth.value}`, new Date().toISOString())
  currentView.value = 'reflections'
}

async function onStartReview(month) {
  try {
    const goals = await apiFetch(`/api/goals?month=${month}`)
    if (!goals?.length) return
    reviewGoals.value      = goals
    reviewMonth.value      = month
    showReviewBanner.value = false
    showReviewModal.value  = true
  } catch {
    // silently ignore
  }
}
</script>

<template>
  <!-- Hydrating session -->
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
            class="relative rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200"
            :class="currentView === tab.id
              ? 'bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] text-white shadow-md shadow-[#0d5f6b]/20'
              : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'"
          >
            {{ tab.label }}
            <!-- Notification dot on Reflections tab when review is due -->
            <span
              v-if="tab.id === 'reflections' && showReviewBanner"
              class="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 border-2 border-white"
            />
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
          class="relative flex-1 py-2.5 text-xs font-semibold transition-all duration-200"
          :class="currentView === tab.id
            ? 'text-[#0d5f6b] border-b-2 border-[#0d5f6b] bg-gradient-to-r from-teal-50/50 to-transparent'
            : 'text-slate-400'"
        >
          {{ tab.label }}
          <span
            v-if="tab.id === 'reflections' && showReviewBanner"
            class="absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-400"
          />
        </button>
      </div>
    </header>

    <!-- ── Weekly review notification banner ─────────────────────────────────── -->
    <transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="-translate-y-full opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-200 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="-translate-y-full opacity-0"
    >
      <div
        v-if="showReviewBanner"
        class="border-b border-amber-200/60 bg-gradient-to-r from-amber-50 to-orange-50/60 overflow-hidden"
      >
        <div class="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
          <!-- Bell icon -->
          <div class="shrink-0 h-8 w-8 rounded-xl bg-amber-100 flex items-center justify-center">
            <svg class="h-4 w-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
          </div>

          <!-- Message -->
          <p class="flex-1 text-sm text-amber-900 font-medium">
            It's been a week since you set your goals — ready for a quick progress check-in?
          </p>

          <!-- Actions -->
          <div class="flex items-center gap-2 shrink-0">
            <button
              @click="openReviewModal"
              class="rounded-xl bg-amber-500 hover:bg-amber-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm transition"
            >
              Yes, let's go
            </button>
            <button
              @click="snoozeReview"
              class="rounded-xl border border-amber-200 bg-white/80 px-4 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 transition"
            >
              Maybe next week
            </button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Views -->
    <Celebrate   v-if="currentView === 'celebrate'" />
    <Journal     v-else-if="currentView === 'journal'" />
    <Planner     v-else-if="currentView === 'planner'" @go-to-goals="currentView = 'goals'" @start-review="onStartReview" />
    <MyGoals     v-else-if="currentView === 'goals'" />
    <Reflections v-else-if="currentView === 'reflections'" />

    <!-- Review modal (rendered on top of everything) -->
    <ReviewModal
      v-if="showReviewModal"
      :goals="reviewGoals"
      :month="reviewMonth"
      @close="showReviewModal = false"
      @saved="onReflectionSaved"
    />

  </div>
</template>
