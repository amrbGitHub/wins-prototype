<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
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
const sidebarOpen = ref(false)

const tabs = [
  {
    id: 'celebrate',
    label: 'Celebrate',
    iconFill: true,
    iconPath: 'M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z',
  },
  {
    id: 'journal',
    label: 'Journal',
    iconFill: false,
    iconPath: 'M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10',
  },
  {
    id: 'planner',
    label: 'Planner',
    iconFill: false,
    iconPath: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5',
  },
  {
    id: 'goals',
    label: 'My Goals',
    iconFill: false,
    iconPath: 'M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.745 3.745 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12z',
  },
  {
    id: 'reflections',
    label: 'Reflections',
    iconFill: false,
    iconPath: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z',
  },
]

const currentTabLabel = computed(() =>
  currentView.value === 'profile'
    ? 'Profile'
    : (tabs.find(t => t.id === currentView.value)?.label ?? 'Wins')
)

function navigate(id) {
  currentView.value = id
  sidebarOpen.value = false
}

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
      <span class="text-sm font-medium text-slate-500">Loading…</span>
    </div>
  </div>

  <!-- Not authenticated -->
  <AuthPage v-else-if="!user" />

  <!-- Authenticated -->
  <div v-else class="flex min-h-screen bg-gradient-to-br from-slate-50 via-white to-teal-50/30 text-slate-900">

    <!-- Onboarding modal -->
    <OnboardingModal v-if="showOnboarding && profileLoaded" @done="onOnboardingDone" />

    <!-- ── Mobile sidebar backdrop ────────────────────────────────────────── -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="sidebarOpen"
        class="fixed inset-0 z-20 bg-slate-900/40 backdrop-blur-sm md:hidden"
        @click="sidebarOpen = false"
      />
    </Transition>

    <!-- ── Sidebar ────────────────────────────────────────────────────────── -->
    <aside
      class="fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-white border-r border-slate-200/60 shadow-sm transition-transform duration-300 ease-in-out"
      :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'"
    >
      <!-- Logo -->
      <div class="px-5 py-5 border-b border-slate-100/80 shrink-0">
        <div class="flex items-center gap-3">
          <div class="relative shrink-0">
            <div class="h-9 w-9 rounded-xl bg-gradient-to-br from-[#0d5f6b] to-[#0a4a54] flex items-center justify-center shadow-md shadow-[#0d5f6b]/25">
              <span class="text-sm font-bold text-white">W</span>
            </div>
            <div
              class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white transition-colors duration-500"
              :class="{
                'bg-emerald-400 animate-pulse': llmStatus === 'online',
                'bg-rose-400':                  llmStatus === 'offline',
                'bg-slate-300':                 llmStatus === 'unknown',
              }"
              :title="`AI server: ${llmStatus}`"
            />
          </div>
          <div>
            <p class="text-sm font-bold text-slate-800 leading-tight">Celebrating Wins</p>
            <p class="text-xs text-slate-400 font-medium leading-tight mt-0.5">Make training impact visible</p>
          </div>
        </div>
      </div>

      <!-- Nav items -->
      <nav class="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          @click="navigate(tab.id)"
          class="relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 text-left"
          :class="currentView === tab.id
            ? 'bg-gradient-to-r from-[#0d5f6b]/10 to-teal-50/60 text-[#0d5f6b] border border-[#0d5f6b]/15 shadow-sm'
            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'"
        >
          <svg
            class="h-5 w-5 shrink-0"
            viewBox="0 0 24 24"
            :fill="tab.iconFill ? 'currentColor' : 'none'"
            :stroke="tab.iconFill ? 'none' : 'currentColor'"
            stroke-width="1.5"
          >
            <path stroke-linecap="round" stroke-linejoin="round" :d="tab.iconPath" />
          </svg>
          {{ tab.label }}
          <!-- Review due badge -->
          <span
            v-if="tab.id === 'reflections' && showReviewBanner"
            class="ml-auto h-2 w-2 rounded-full bg-amber-400"
          />
        </button>
      </nav>

      <!-- User + sign out -->
      <div class="px-3 py-4 border-t border-slate-100/80 space-y-1 shrink-0">
        <button
          @click="navigate('profile')"
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200"
          :class="currentView === 'profile'
            ? 'bg-gradient-to-r from-[#0d5f6b]/10 to-teal-50/60 text-[#0d5f6b] border border-[#0d5f6b]/15 shadow-sm'
            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'"
        >
          <div class="h-7 w-7 rounded-full bg-gradient-to-br from-[#0d5f6b] to-[#0a4a54] flex items-center justify-center text-white text-xs font-bold shadow-sm shrink-0">
            {{ (profile?.firstName || user.email)[0].toUpperCase() }}
          </div>
          <span class="truncate">
            {{ profile?.firstName
                ? `${profile.firstName}${profile.lastName ? ' ' + profile.lastName : ''}`
                : user.email }}
          </span>
        </button>
        <button
          @click="signOut"
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-all duration-200"
        >
          <svg class="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
          </svg>
          Sign out
        </button>
      </div>
    </aside>

    <!-- ── Main content ───────────────────────────────────────────────────── -->
    <div class="flex flex-1 flex-col md:ml-64 min-h-screen">

      <!-- Mobile top bar -->
      <header class="md:hidden sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 bg-white/90 backdrop-blur-xl border-b border-slate-200/60 shadow-sm">
        <button
          @click="sidebarOpen = true"
          class="rounded-xl p-2 text-slate-500 hover:bg-slate-100 transition"
        >
          <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
        <span class="text-sm font-bold text-slate-800">{{ currentTabLabel }}</span>
        <button
          @click="navigate('profile')"
          class="h-8 w-8 rounded-full bg-gradient-to-br from-[#0d5f6b] to-[#0a4a54] flex items-center justify-center text-white text-xs font-bold shadow-sm shrink-0"
        >
          {{ (profile?.firstName || user.email)[0].toUpperCase() }}
        </button>
      </header>

      <!-- Review banner -->
      <Transition
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="-translate-y-2 opacity-0"
        enter-to-class="translate-y-0 opacity-100"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="translate-y-0 opacity-100"
        leave-to-class="-translate-y-2 opacity-0"
      >
        <div v-if="showReviewBanner" class="border-b border-amber-200/60 bg-gradient-to-r from-amber-50 to-orange-50/60 shrink-0">
          <div class="px-6 py-3 flex items-center gap-3">
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
      </Transition>

      <!-- Page content -->
      <Celebrate
        v-if="currentView === 'celebrate'"
      />
      <Journal
        v-else-if="currentView === 'journal'"
      />
      <Planner
        v-else-if="currentView === 'planner'"
        :first-name="profile?.firstName || ''"
        @go-to-goals="navigate('goals')"
        @start-review="onStartReview"
      />
      <MyGoals
        v-else-if="currentView === 'goals'"
        :key="'goals-' + myGoalsKey"
      />
      <Reflections
        v-else-if="currentView === 'reflections'"
      />
      <UserProfile
        v-else-if="currentView === 'profile'"
        :profile="profile"
        @updated="onProfileUpdated"
      />
    </div>

    <!-- ── Modals ─────────────────────────────────────────────────────────── -->
    <ReviewModal
      v-if="showReviewModal"
      :goals="reviewGoals"
      :month="reviewMonth"
      @close="showReviewModal = false"
      @saved="onReflectionSaved"
      @goals-updated="onGoalsUpdated"
    />

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
              <div class="flex gap-2 flex-wrap">
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
