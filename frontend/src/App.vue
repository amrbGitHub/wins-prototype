<script setup>
import { ref, watch, onUnmounted } from 'vue'
import { useAuth } from './composables/useAuth.js'
import { useApi }  from './composables/useApi.js'
import Celebrate      from './components/Celebrate.vue'
import Journal        from './components/Journal.vue'
import Planner        from './components/Planner.vue'
import MyGoals        from './components/MyGoals.vue'
import Reflections    from './components/Reflections.vue'
import ReviewModal    from './components/ReviewModal.vue'
import OnboardingModal from './components/OnboardingModal.vue'
import UserProfile    from './components/UserProfile.vue'
import AuthPage       from './components/AuthPage.vue'

const { user, loading, signOut } = useAuth()
const { apiFetch, apiFetchPublic } = useApi()

const currentView = ref('celebrate')

const tabs = [
  { id: 'celebrate',   label: 'Celebrate'   },
  { id: 'journal',     label: 'Journal'     },
  { id: 'planner',     label: 'Planner'     },
  { id: 'goals',       label: 'My Goals'    },
  { id: 'reflections', label: 'Reflections' },
  { id: 'profile',     label: 'Profile'     },
]

// ── Profile ───────────────────────────────────────────────────────────────────
const profile        = ref(null)
const showOnboarding = ref(false)
const profileLoaded  = ref(false)

async function loadProfile() {
  try {
    profile.value = await apiFetch('/api/profile')
    showOnboarding.value = !profile.value?.onboardedAt
  } catch {
    showOnboarding.value = false
  } finally {
    profileLoaded.value = true
  }
}

function onOnboardingDone(newProfile) {
  profile.value        = newProfile
  showOnboarding.value = false
}

function onProfileUpdated(newProfile) {
  profile.value = newProfile
}

// ── LLM health indicator ──────────────────────────────────────────────────────
const llmStatus = ref('unknown')
let _statusTimer = null

async function checkLlmStatus() {
  try {
    const data = await apiFetchPublic('/api/health')
    llmStatus.value = data?.ollama === 'online' ? 'online' : 'offline'
  } catch {
    llmStatus.value = 'offline'
  }
}

// ── Weekly review notification ────────────────────────────────────────────────
const showReviewBanner = ref(false)
const showReviewModal  = ref(false)
const reviewGoals      = ref([])
const reviewMonth      = ref('')

async function checkReviewDue() {
  const forceTest    = new URLSearchParams(window.location.search).has('testReview')
  const currentMonth = new Date().toISOString().slice(0, 7)

  if (!forceTest) {
    const snoozed = localStorage.getItem(`wins-review-snoozed-${currentMonth}`)
    if (snoozed) {
      const daysSince = (Date.now() - new Date(snoozed).getTime()) / (1000 * 60 * 60 * 24)
      if (daysSince < 7) return
    }
  }

  try {
    const goals = await apiFetch(`/api/goals?month=${currentMonth}`)
    if (!goals?.length) return

    if (!forceTest) {
      const oldestCreated = Math.min(...goals.map(g => g.createdAt))
      const daysSinceSet  = (Date.now() - oldestCreated) / (1000 * 60 * 60 * 24)
      if (daysSinceSet < 7) return
    }

    reviewGoals.value      = goals
    reviewMonth.value      = currentMonth
    showReviewBanner.value = true
  } catch { /* non-critical */ }
}

// ── Month-end goal rollover ───────────────────────────────────────────────────
const showRolloverModal  = ref(false)
const rolloverGoals      = ref([])
const rolloverFromMonth  = ref('')
const rolloverToMonth    = ref('')
const rolloverSelections = ref({})
const rolloverSaving     = ref(false)

async function checkMonthRollover() {
  const now       = new Date()
  const prev      = new Date(now.getFullYear(), now.getMonth() - 1)
  const prevMonth = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  if (localStorage.getItem(`wins-rollover-checked-${prevMonth}`)) return

  try {
    const goals = await apiFetch(`/api/goals?month=${prevMonth}`)
    const unmet  = (goals || []).filter(g => g.status === 'active')
    if (!unmet.length) { localStorage.setItem(`wins-rollover-checked-${prevMonth}`, '1'); return }

    rolloverGoals.value      = unmet
    rolloverFromMonth.value  = prevMonth
    rolloverToMonth.value    = thisMonth
    rolloverSelections.value = Object.fromEntries(unmet.map(g => [g.id, 'transfer']))
    showRolloverModal.value  = true
  } catch { /* non-critical */ }
}

async function applyRollover() {
  rolloverSaving.value = true
  try {
    const toTransfer = rolloverGoals.value.filter(g => rolloverSelections.value[g.id] === 'transfer').map(g => g.id)
    const toShelf    = rolloverGoals.value.filter(g => rolloverSelections.value[g.id] === 'shelf').map(g => g.id)

    await Promise.all([
      toTransfer.length ? apiFetch('/api/goals/transfer', {
        method: 'POST',
        body: JSON.stringify({ fromMonth: rolloverFromMonth.value, toMonth: rolloverToMonth.value, goalIds: toTransfer }),
      }) : null,
      toShelf.length ? apiFetch('/api/goals/bulk-status', {
        method: 'PATCH',
        body: JSON.stringify({ goalIds: toShelf, status: 'shelved' }),
      }) : null,
    ].filter(Boolean))

    localStorage.setItem(`wins-rollover-checked-${rolloverFromMonth.value}`, '1')
    showRolloverModal.value = false
  } catch (e) {
    alert('Something went wrong: ' + e.message)
  } finally {
    rolloverSaving.value = false
  }
}

function dismissRollover() {
  localStorage.setItem(`wins-rollover-checked-${rolloverFromMonth.value}`, '1')
  showRolloverModal.value = false
}

function prevMonthLabel(m) {
  if (!m) return ''
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// ── Review modal helpers ──────────────────────────────────────────────────────
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
  localStorage.setItem(`wins-review-snoozed-${reviewMonth.value}`, new Date().toISOString())
  currentView.value = 'reflections'
}

// Re-fetch reviewGoals and bump key so MyGoals reloads if it's open
const myGoalsKey = ref(0)

async function onGoalsUpdated() {
  myGoalsKey.value++
  try {
    reviewGoals.value = await apiFetch(`/api/goals?month=${reviewMonth.value}`)
  } catch { /* non-critical */ }
}

async function onStartReview(month) {
  try {
    const goals = await apiFetch(`/api/goals?month=${month}`)
    if (!goals?.length) return
    reviewGoals.value      = goals
    reviewMonth.value      = month
    showReviewBanner.value = false
    showReviewModal.value  = true
  } catch { /* silently ignore */ }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
watch(user, async (u) => {
  if (u) {
    await loadProfile()
    checkLlmStatus()
    _statusTimer = setInterval(checkLlmStatus, 30_000)
    await Promise.all([checkReviewDue(), checkMonthRollover()])
  }
}, { immediate: true })

onUnmounted(() => clearInterval(_statusTimer))
</script>

<template>
  <!-- Loading -->
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

    <!-- Onboarding modal — shown once for new/existing users without a profile -->
    <OnboardingModal v-if="showOnboarding && profileLoaded" @done="onOnboardingDone" />

    <!-- Header -->
    <header class="sticky top-0 z-10 border-b border-slate-200/60 bg-white/80 backdrop-blur-xl shadow-sm">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">

        <!-- Logo + LLM dot -->
        <div class="flex items-center gap-3">
          <div class="relative">
            <div class="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-[#0d5f6b] to-[#0a4a54] text-white shadow-lg shadow-[#0d5f6b]/25">
              <span class="text-lg font-bold">W</span>
            </div>
            <div
              class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white transition-colors duration-500"
              :class="{
                'bg-emerald-400 animate-pulse': llmStatus === 'online',
                'bg-rose-400':                  llmStatus === 'offline',
                'bg-slate-300':                 llmStatus === 'unknown',
              }"
              :title="`AI server: ${llmStatus}`"
            />
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
            <span
              v-if="tab.id === 'reflections' && showReviewBanner"
              class="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 border-2 border-white"
            />
          </button>
        </div>

        <!-- User + sign out -->
        <div class="flex items-center gap-3">
          <button
            @click="currentView = 'profile'"
            class="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100/80 hover:bg-slate-200/60 transition"
          >
            <div class="h-7 w-7 rounded-full bg-gradient-to-br from-[#0d5f6b] to-[#0a4a54] flex items-center justify-center text-white text-xs font-bold shadow-sm">
              {{ (profile?.firstName || user.email)[0].toUpperCase() }}
            </div>
            <span class="text-xs text-slate-600 font-medium truncate max-w-[150px]">
              {{ profile?.firstName ? `${profile.firstName}${profile.lastName ? ' ' + profile.lastName : ''}` : user.email }}
            </span>
          </button>
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
      <div class="flex sm:hidden border-t border-slate-100/60 bg-white/50 overflow-x-auto">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          @click="currentView = tab.id"
          class="relative flex-shrink-0 px-4 py-2.5 text-xs font-semibold transition-all duration-200"
          :class="currentView === tab.id
            ? 'text-[#0d5f6b] border-b-2 border-[#0d5f6b]'
            : 'text-slate-400'"
        >
          {{ tab.label }}
          <span
            v-if="tab.id === 'reflections' && showReviewBanner"
            class="absolute top-1 right-0.5 h-2 w-2 rounded-full bg-amber-400"
          />
        </button>
      </div>
    </header>

    <!-- Weekly review banner -->
    <transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="-translate-y-full opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-200 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="-translate-y-full opacity-0"
    >
      <div v-if="showReviewBanner" class="border-b border-amber-200/60 bg-gradient-to-r from-amber-50 to-orange-50/60">
        <div class="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
          <div class="shrink-0 h-8 w-8 rounded-xl bg-amber-100 flex items-center justify-center">
            <svg class="h-4 w-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
          </div>
          <p class="flex-1 text-sm text-amber-900 font-medium">
            Ready for a quick progress check-in{{ profile?.firstName ? `, ${profile.firstName}` : '' }}?
          </p>
          <div class="flex items-center gap-2 shrink-0">
            <button @click="openReviewModal" class="rounded-xl bg-amber-500 hover:bg-amber-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm transition">Yes, let's go</button>
            <button @click="snoozeReview" class="rounded-xl border border-amber-200 bg-white/80 px-4 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 transition">Maybe next week</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Views -->
    <Celebrate   v-if="currentView === 'celebrate'" />
    <Journal     v-else-if="currentView === 'journal'" />
    <Planner
      v-else-if="currentView === 'planner'"
      :first-name="profile?.firstName || ''"
      @go-to-goals="currentView = 'goals'"
      @start-review="onStartReview"
    />
    <MyGoals     v-else-if="currentView === 'goals'" :key="myGoalsKey" />
    <Reflections v-else-if="currentView === 'reflections'" />
    <UserProfile
      v-else-if="currentView === 'profile'"
      :profile="profile"
      @updated="onProfileUpdated"
    />

    <!-- Review modal -->
    <ReviewModal
      v-if="showReviewModal"
      :goals="reviewGoals"
      :month="reviewMonth"
      @close="showReviewModal = false"
      @saved="onReflectionSaved"
      @goals-updated="onGoalsUpdated"
    />

    <!-- Month-end rollover modal -->
    <Teleport to="body">
      <div v-if="showRolloverModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />
        <div class="relative z-10 w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden">
          <div class="px-7 pt-7 pb-4">
            <h2 class="text-lg font-bold text-slate-800">Unfinished goals from {{ prevMonthLabel(rolloverFromMonth) }}</h2>
            <p class="text-sm text-slate-500 mt-1">What would you like to do with each goal?</p>
          </div>

          <div class="px-7 pb-2 space-y-3 max-h-72 overflow-y-auto">
            <div
              v-for="goal in rolloverGoals"
              :key="goal.id"
              class="rounded-2xl border border-slate-200/60 bg-slate-50/50 px-4 py-3"
            >
              <p class="text-sm font-semibold text-slate-800 mb-2.5">{{ goal.title }}</p>
              <div class="flex gap-2">
                <button
                  v-for="opt in [
                    { val: 'transfer', label: 'Move to this month' },
                    { val: 'shelf',    label: 'Archive' },
                    { val: 'keep',     label: 'Leave as-is' },
                  ]"
                  :key="opt.val"
                  @click="rolloverSelections[goal.id] = opt.val"
                  class="rounded-xl px-2.5 py-1 text-xs font-semibold border transition"
                  :class="rolloverSelections[goal.id] === opt.val
                    ? 'border-[#0d5f6b] bg-[#0d5f6b]/10 text-[#0d5f6b]'
                    : 'border-slate-200/70 text-slate-500 hover:border-slate-300'"
                >{{ opt.label }}</button>
              </div>
            </div>
          </div>

          <div class="px-7 py-5 flex gap-2 border-t border-slate-100">
            <button @click="dismissRollover" class="rounded-2xl border border-slate-200/70 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">Skip</button>
            <button
              @click="applyRollover"
              :disabled="rolloverSaving"
              class="flex-1 rounded-2xl bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] py-2.5 text-sm font-bold text-white shadow-md disabled:opacity-50 transition"
            >{{ rolloverSaving ? 'Saving…' : 'Confirm choices' }}</button>
          </div>
        </div>
      </div>
    </Teleport>

  </div>
</template>
