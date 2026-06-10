<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { useAuth } from './composables/useAuth.js'
import { useApi }  from './composables/useApi.js'
import { thisMonthLocal } from './lib/dates.js'
import {
  Trophy, BookOpen, CalendarDays, Target, Brain, Layers,
  User, LogOut, Menu, X, Wifi, WifiOff, ChevronRight,
  Bell, Sparkles, Home as HomeIcon, Shield,
} from 'lucide-vue-next'
import HomeView        from './components/Home.vue'
import Elsie           from './components/Elsie.vue'
import ElsiePage       from './components/ElsiePage.vue'
import Celebrate       from './components/Celebrate.vue'
import Journal         from './components/Journal.vue'
import MyGoals         from './components/MyGoals.vue'
import Programs        from './components/Programs.vue'
import Reflections     from './components/Reflections.vue'
import ReviewModal     from './components/ReviewModal.vue'
import OnboardingModal from './components/OnboardingModal.vue'
import UserProfile     from './components/UserProfile.vue'
import AuthPage        from './components/AuthPage.vue'
import AdminPage       from './components/AdminPage.vue'

const { user, loading, signOut, onAuthEvent } = useAuth()
const { apiFetch, apiFetchPublic } = useApi()

const currentView = ref('home')
const sidebarOpen = ref(false)
const elsieOpen   = ref(false)   // Elsie is a persistent overlay, not a tab

const tabs = [
  { id: 'home',        label: 'Home',         icon: HomeIcon,     color: 'teal'    },
  { id: 'programs',    label: 'Programs',     icon: Layers,       color: 'cyan'    },
  { id: 'goals',       label: 'My Goals',     icon: Target,       color: 'emerald' },
  { id: 'journal',     label: 'Journal',      icon: BookOpen,     color: 'violet'  },
  { id: 'celebrate',   label: 'Celebrate',    icon: Trophy,       color: 'amber'   },
  { id: 'reflections', label: 'Reflections',  icon: Brain,        color: 'rose'    },
]

const tabColorMap = {
  amber:   { active: 'text-amber-600 bg-amber-50/80 border border-amber-200/60',      dot: 'bg-amber-400',   icon: 'text-amber-500'   },
  violet:  { active: 'text-violet-600 bg-violet-50/80 border border-violet-200/60',   dot: 'bg-violet-400',  icon: 'text-violet-500'  },
  teal:    { active: 'text-teal-700 bg-teal-50/80 border border-teal-200/60',          dot: 'bg-teal-400',    icon: 'text-teal-600'    },
  emerald: { active: 'text-emerald-700 bg-emerald-50/80 border border-emerald-200/60', dot: 'bg-emerald-400', icon: 'text-emerald-600' },
  cyan:    { active: 'text-cyan-700 bg-cyan-50/80 border border-cyan-200/60',          dot: 'bg-cyan-400',    icon: 'text-cyan-600'    },
  rose:    { active: 'text-rose-600 bg-rose-50/80 border border-rose-200/60',          dot: 'bg-rose-400',    icon: 'text-rose-500'    },
}

const currentTabLabel = computed(() =>
  currentView.value === 'profile'
    ? 'Profile'
    : currentView.value === 'admin'
    ? 'Admin'
    : currentView.value === 'elsie'
    ? 'LC'
    : (tabs.find(t => t.id === currentView.value)?.label ?? 'Wins')
)

const isAdmin = computed(() => profile.value?.role === 'admin')

const activeTabColor = computed(() =>
  tabs.find(t => t.id === currentView.value)?.color ?? 'teal'
)

function navigate(id) {
  // 'elsie' navigates to the full-page view (sidebar click or link within app)
  // The floating button separately sets elsieOpen for the panel overlay
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
  currentView.value    = 'elsie'   // guide new users straight to Elsie for goal-setting
}

function onProfileUpdated(newProfile) {
  profile.value = newProfile
}

// React to multi-tab auth events: a sign-out in another tab should drop our
// cached profile so we don't show stale data. Token refresh is a noop.
const _unsubAuth = onAuthEvent((event) => {
  if (event === 'SIGNED_OUT') {
    profile.value        = null
    showOnboarding.value = false
    profileLoaded.value  = false
    elsieOpen.value      = false
    currentView.value    = 'home'
  }
})
onUnmounted(() => { _unsubAuth?.() })

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
  const currentMonth = thisMonthLocal()

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
      // Avoid Math.min(...arr) — call-stack arg-spread limit is ~10k in older browsers.
      const oldestCreated = goals.reduce((m, g) => Math.min(m, g.createdAt), Infinity)
      const daysSinceSet  = (Date.now() - oldestCreated) / (1000 * 60 * 60 * 24)
      if (daysSinceSet < 7) return
    }

    reviewGoals.value      = goals
    reviewMonth.value      = currentMonth
    showReviewBanner.value = true
  } catch { /* non-critical */ }
}

// ── Month-end rollover ────────────────────────────────────────────────────────
const showRolloverModal  = ref(false)
const rolloverGoals      = ref([])
const rolloverFromMonth  = ref('')
const rolloverToMonth    = ref('')
const rolloverSelections = ref({})
const rolloverSaving     = ref(false)

// ── Global Esc handler for dismissible overlays ───────────────────────────────
// Self-contained modals (OnboardingModal, ReviewModal) handle their own.
function onEscKey(e) {
  if (e.key !== 'Escape') return
  if (elsieOpen.value)         { elsieOpen.value = false;          e.preventDefault(); return }
  if (showRolloverModal.value) { showRolloverModal.value = false;  e.preventDefault(); return }
  if (sidebarOpen.value)       { sidebarOpen.value = false;        e.preventDefault(); return }
}
document.addEventListener('keydown', onEscKey)
onUnmounted(() => document.removeEventListener('keydown', onEscKey))

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
    const transferIds = rolloverGoals.value.filter(g => rolloverSelections.value[g.id] === 'transfer').map(g => g.id)
    const shelfIds    = rolloverGoals.value.filter(g => rolloverSelections.value[g.id] === 'shelf').map(g => g.id)

    // Single best-effort atomic call. Server reverts the shelve if transfer fails.
    await apiFetch('/api/goals/rollover', {
      method: 'POST',
      body: JSON.stringify({
        fromMonth: rolloverFromMonth.value,
        toMonth:   rolloverToMonth.value,
        transferIds,
        shelfIds,
      }),
    })

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

// ── Review helpers ────────────────────────────────────────────────────────────
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
  <!-- ── Loading screen ─────────────────────────────────────────────────────── -->
  <div v-if="loading" class="min-h-screen flex items-center justify-center" style="background:var(--page-bg)">
    <div class="flex flex-col items-center gap-4">
      <div class="relative">
        <div class="h-16 w-16 rounded-3xl flex items-center justify-center shadow-2xl"
             style="background:linear-gradient(135deg,#0d5f6b,#0a4a54)">
          <Sparkles class="h-8 w-8 text-white" />
        </div>
        <span class="absolute inset-0 rounded-3xl animate-ping opacity-20"
              style="background:#0d5f6b"></span>
      </div>
      <div class="text-center">
        <p class="font-bold text-slate-700 text-lg">Celebrating Wins</p>
        <p class="text-sm text-slate-400 mt-0.5">Loading your workspace…</p>
      </div>
    </div>
  </div>

  <!-- ── Auth page ──────────────────────────────────────────────────────────── -->
  <AuthPage v-else-if="!user" />

  <!-- ── App shell ──────────────────────────────────────────────────────────── -->
  <div v-else class="flex min-h-screen" style="background:var(--page-bg)">

    <OnboardingModal v-if="showOnboarding && profileLoaded" @done="onOnboardingDone" />

    <!-- Mobile backdrop -->
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
        class="fixed inset-0 z-20 md:hidden"
        style="background:rgba(0,0,0,0.55);backdrop-filter:blur(4px)"
        @click="sidebarOpen = false"
      />
    </Transition>

    <!-- ════════════════════════════════════════════════════════════════════
         SIDEBAR
    ═════════════════════════════════════════════════════════════════════ -->
    <aside
      class="fixed inset-y-0 left-0 z-30 flex w-64 flex-col transition-transform duration-300 ease-in-out"
      :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'"
      style="background:var(--sidebar-bg)"
    >
      <!-- Inner gradient overlay -->
      <div class="absolute inset-0 pointer-events-none"
           style="background:linear-gradient(160deg,rgba(13,95,107,0.18) 0%,transparent 60%)"></div>

      <!-- Logo / brand — clicking navigates home -->
      <div class="relative px-5 pt-6 pb-5 shrink-0">
        <button
          @click="navigate('home')"
          class="flex items-center gap-3 w-full text-left transition-opacity hover:opacity-80 focus:outline-none"
        >
          <div class="relative shrink-0">
            <div class="h-10 w-10 rounded-2xl flex items-center justify-center shadow-lg"
                 style="background:linear-gradient(135deg,#0d5f6b,#2dd4bf)">
              <Sparkles class="h-5 w-5 text-white" />
            </div>
            <!-- AI status dot -->
            <span
              class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 transition-colors duration-500"
              :class="{
                'bg-emerald-400': llmStatus === 'online',
                'bg-rose-400':    llmStatus === 'offline',
                'bg-slate-500':   llmStatus === 'unknown',
              }"
              style="border-color:var(--sidebar-bg)"
              :title="`AI: ${llmStatus}`"
            />
          </div>
          <div>
            <p class="font-bold text-white text-sm leading-tight">Celebrating Wins</p>
            <p class="text-xs leading-tight mt-0.5" style="color:var(--sidebar-text)">Your L&D companion</p>
          </div>
        </button>
      </div>

      <!-- Divider -->
      <div class="mx-5 h-px shrink-0" style="background:rgba(255,255,255,0.07)"></div>

      <!-- Nav -->
      <nav class="relative flex-1 px-3 py-4 overflow-y-auto flex flex-col gap-0.5">

        <!-- Elsie — prominent AI button at the top -->
        <button
          @click="navigate('elsie')"
          class="flex items-center gap-3 w-full rounded-xl px-3 py-2.5 mb-2 transition-all duration-200 group"
          :class="currentView === 'elsie'
            ? 'text-teal-100'
            : 'text-white/60 hover:text-white/90'"
          :style="currentView === 'elsie'
            ? 'background:linear-gradient(135deg,rgba(13,95,107,0.55),rgba(14,128,149,0.45));box-shadow:inset 2px 0 0 #2dd4bf'
            : 'background:rgba(255,255,255,0.04)'"
        >
          <div class="relative shrink-0">
            <div class="h-8 w-8 rounded-xl flex items-center justify-center transition-all duration-200"
                 :style="currentView === 'elsie' ? 'background:rgba(45,212,191,0.25)' : 'background:rgba(255,255,255,0.08)'">
              <Sparkles class="h-4 w-4 transition-colors" :class="currentView === 'elsie' ? 'text-teal-300' : ''" />
            </div>
            <!-- Online dot -->
            <span class="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-[var(--sidebar-bg)]"
                  :class="currentView === 'elsie' ? 'bg-emerald-400' : 'bg-emerald-500/60'"></span>
          </div>
          <div class="flex-1 min-w-0 text-left">
            <p class="text-sm font-bold leading-tight">LC</p>
            <p class="text-[10px] leading-tight opacity-60">Learning Companion</p>
          </div>
          <span class="text-[9px] font-bold rounded-full px-1.5 py-0.5 shrink-0"
                style="background:rgba(45,212,191,0.2);color:#2dd4bf">AI</span>
        </button>

        <!-- Divider -->
        <div class="mx-2 mb-2 h-px" style="background:rgba(255,255,255,0.07)"></div>

        <!-- Page tabs -->
        <button
          v-for="tab in tabs"
          :key="tab.id"
          @click="navigate(tab.id)"
          class="nav-item group"
          :class="{ active: currentView === tab.id }"
        >
          <component
            :is="tab.icon"
            class="h-5 w-5 shrink-0 transition-transform duration-200 group-hover:scale-110"
            :class="currentView === tab.id ? 'text-teal-300' : ''"
          />
          <span class="flex-1 font-medium">{{ tab.label }}</span>
          <span
            v-if="tab.id === 'reflections' && showReviewBanner"
            class="h-2 w-2 rounded-full animate-pulse shrink-0"
            style="background:#f59e0b"
          />
          <ChevronRight
            v-if="currentView === tab.id"
            class="h-3.5 w-3.5 shrink-0 text-teal-400 opacity-60"
          />
        </button>

      </nav>

      <!-- Divider -->
      <div class="mx-5 h-px shrink-0" style="background:rgba(255,255,255,0.07)"></div>

      <!-- User section -->
      <div class="relative px-3 py-4 shrink-0 space-y-1">
        <button
          @click="navigate('profile')"
          class="nav-item group"
          :class="{ active: currentView === 'profile' }"
        >
          <div class="h-7 w-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white shadow-md ring-2 ring-white/10"
               style="background:linear-gradient(135deg,#0d5f6b,#2dd4bf)">
            {{ (profile?.firstName || user.email)[0].toUpperCase() }}
          </div>
          <span class="flex-1 font-medium truncate text-sm">
            {{ profile?.firstName
                ? `${profile.firstName}${profile.lastName ? ' '+profile.lastName : ''}`
                : user.email }}
          </span>
        </button>

        <button
          v-if="isAdmin"
          @click="navigate('admin')"
          class="nav-item group"
          :class="{ active: currentView === 'admin' }"
        >
          <Shield class="h-4 w-4 shrink-0" :class="currentView === 'admin' ? 'text-teal-300' : ''" />
          <span class="text-sm font-medium">Admin</span>
        </button>

        <button
          @click="signOut"
          class="nav-item group"
          style="color:rgba(255,255,255,0.35)"
        >
          <LogOut class="h-4 w-4 shrink-0 group-hover:text-rose-400 transition-colors" />
          <span class="text-sm font-medium group-hover:text-rose-300 transition-colors">Sign out</span>
        </button>
      </div>
    </aside>

    <!-- ════════════════════════════════════════════════════════════════════
         MAIN CONTENT
    ═════════════════════════════════════════════════════════════════════ -->
    <div class="flex flex-1 flex-col min-h-screen md:ml-64">

      <!-- Mobile top bar -->
      <header class="md:hidden sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 shrink-0"
              style="background:rgba(255,255,255,0.9);backdrop-filter:blur(20px);border-bottom:1px solid rgba(0,0,0,0.06)">
        <button
          @click="sidebarOpen = true"
          class="h-9 w-9 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 transition"
        >
          <Menu class="h-5 w-5" />
        </button>
        <span class="text-sm font-bold text-slate-800">{{ currentTabLabel }}</span>
        <button
          @click="navigate('profile')"
          class="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white shadow"
          style="background:linear-gradient(135deg,#0d5f6b,#2dd4bf)"
        >
          {{ (profile?.firstName || user.email)[0].toUpperCase() }}
        </button>
      </header>

      <!-- Review banner -->
      <Transition
        enter-active-class="transition duration-400 ease-out"
        enter-from-class="-translate-y-3 opacity-0"
        enter-to-class="translate-y-0 opacity-100"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="translate-y-0 opacity-100"
        leave-to-class="-translate-y-3 opacity-0"
      >
        <div v-if="showReviewBanner" class="shrink-0 mx-6 mt-4 rounded-2xl overflow-hidden"
             style="background:linear-gradient(135deg,#fffbeb,#fef3c7);border:1px solid rgba(251,191,36,0.3);box-shadow:0 2px 12px rgba(245,158,11,0.12)">
          <div class="px-5 py-3.5 flex items-center gap-4">
            <div class="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center"
                 style="background:linear-gradient(135deg,#f59e0b,#f97316)">
              <Bell class="h-4 w-4 text-white" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-amber-900 leading-tight">
                Time for your progress check-in{{ profile?.firstName ? `, ${profile.firstName}` : '' }}!
              </p>
              <p class="text-xs text-amber-700 mt-0.5">Review your goals and keep the momentum going</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button @click="openReviewModal"
                      class="btn btn-primary text-xs px-3 py-2"
                      style="background:linear-gradient(135deg,#f59e0b,#f97316);box-shadow:0 2px 8px rgba(245,158,11,0.35)">
                Let's go →
              </button>
              <button @click="snoozeReview"
                      class="text-xs font-semibold text-amber-600 hover:text-amber-800 px-2 py-1.5 rounded-lg hover:bg-amber-100 transition">
                Later
              </button>
            </div>
          </div>
        </div>
      </Transition>

      <!-- Page content -->
      <HomeView
        v-if="currentView === 'home'"
        :first-name="profile?.firstName || ''"
        @navigate="navigate"
      />
      <ElsiePage
        v-else-if="currentView === 'elsie'"
        :first-name="profile?.firstName || ''"
        @goals-updated="onGoalsUpdated"
        @navigate="navigate"
      />
      <Celebrate       v-else-if="currentView === 'celebrate'" />
      <Journal         v-else-if="currentView === 'journal'" />
      <MyGoals
        v-else-if="currentView === 'goals'"
        :key="'goals-' + myGoalsKey"
        @navigate="navigate"
      />
      <Programs        v-else-if="currentView === 'programs'" />
      <Reflections     v-else-if="currentView === 'reflections'" />
      <UserProfile
        v-else-if="currentView === 'profile'"
        :profile="profile"
        @updated="onProfileUpdated"
      />
      <AdminPage
        v-else-if="currentView === 'admin' && isAdmin"
      />
    </div>

    <!-- ── Elsie persistent overlay + floating trigger ─────────────────────── -->
    <Teleport to="body">
      <!-- Floating trigger button (hidden when Elsie is open) -->
      <Transition
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="opacity-0 scale-90 translate-y-2"
        enter-to-class="opacity-100 scale-100 translate-y-0"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="opacity-100 scale-100 translate-y-0"
        leave-to-class="opacity-0 scale-90 translate-y-2"
      >
        <button
          v-if="!elsieOpen && user && profileLoaded && currentView !== 'elsie'"
          @click="elsieOpen = true"
          class="fixed bottom-6 right-6 z-40 flex items-center gap-2.5 rounded-2xl px-4 py-3 text-white font-semibold shadow-2xl transition-all duration-200 hover:scale-105 active:scale-95"
          style="background:linear-gradient(135deg,#0d5f6b,#0e8095);box-shadow:0 8px 32px rgba(13,95,107,0.42)"
        >
          <!-- Subtle pulse ring -->
          <span class="absolute inset-0 rounded-2xl animate-ping opacity-10"
                style="background:linear-gradient(135deg,#0d5f6b,#0e8095)"></span>
          <Sparkles class="h-5 w-5 relative" />
          <span class="text-sm relative">LC</span>
        </button>
      </Transition>

      <!-- Elsie overlay -->
      <Transition
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
      >
        <div
          v-if="elsieOpen"
          class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
        >
          <!-- Backdrop -->
          <div
            class="absolute inset-0"
            style="background:rgba(0,0,0,0.5);backdrop-filter:blur(10px)"
            @click="elsieOpen = false"
          />
          <!-- Panel -->
          <div class="relative z-10 w-full max-w-md shadow-2xl" style="border-radius:28px;overflow:hidden">
            <Elsie
              :first-name="profile?.firstName || ''"
              @close="elsieOpen = false"
              @goals-updated="onGoalsUpdated"
              @navigate="(id) => { elsieOpen = false; navigate(id) }"
            />
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ── Review modal ────────────────────────────────────────────────────── -->
    <ReviewModal
      v-if="showReviewModal"
      :goals="reviewGoals"
      :month="reviewMonth"
      @close="showReviewModal = false"
      @saved="onReflectionSaved"
      @goals-updated="onGoalsUpdated"
    />

    <!-- ── Rollover modal ──────────────────────────────────────────────────── -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
      >
        <div v-if="showRolloverModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="absolute inset-0" style="background:rgba(0,0,0,0.5);backdrop-filter:blur(8px)"
               @click="dismissRollover" />
          <div class="relative z-10 w-full max-w-md overflow-hidden"
               style="background:white;border-radius:28px;box-shadow:var(--shadow-modal)">

            <!-- Header -->
            <div class="px-7 pt-7 pb-5">
              <div class="flex items-center gap-3 mb-4">
                <div class="h-11 w-11 rounded-2xl flex items-center justify-center"
                     style="background:linear-gradient(135deg,#0d5f6b,#0ea5e9)">
                  <CalendarDays class="h-5 w-5 text-white" />
                </div>
                <div>
                  <h2 class="text-base font-bold text-slate-800">Unfinished goals</h2>
                  <p class="text-xs text-slate-500">from {{ prevMonthLabel(rolloverFromMonth) }}</p>
                </div>
              </div>
              <p class="text-sm text-slate-500 leading-relaxed">What would you like to do with each goal?</p>
            </div>

            <!-- Goals list -->
            <div class="px-7 pb-4 space-y-3 max-h-72 overflow-y-auto">
              <div
                v-for="goal in rolloverGoals"
                :key="goal.id"
                class="rounded-2xl p-4"
                style="background:#f8fafc;border:1px solid rgba(0,0,0,0.05)"
              >
                <p class="text-sm font-semibold text-slate-800 mb-3">{{ goal.title }}</p>
                <div class="flex gap-2 flex-wrap">
                  <button
                    v-for="opt in [
                      { val: 'transfer', label: '→ This month', grad: 'linear-gradient(135deg,#0d5f6b,#0ea5e9)' },
                      { val: 'shelf',    label: 'Archive', grad: 'linear-gradient(135deg,#6b7280,#4b5563)' },
                      { val: 'keep',     label: 'Leave as-is', grad: '' },
                    ]"
                    :key="opt.val"
                    @click="rolloverSelections[goal.id] = opt.val"
                    class="rounded-xl px-3 py-1.5 text-xs font-semibold transition-all duration-200"
                    :style="rolloverSelections[goal.id] === opt.val
                      ? `background:${opt.grad || 'linear-gradient(135deg,#64748b,#475569)'};color:white;box-shadow:0 2px 8px rgba(0,0,0,0.15)`
                      : 'background:white;color:#6b7280;border:1.5px solid rgba(0,0,0,0.1)'"
                  >{{ opt.label }}</button>
                </div>
              </div>
            </div>

            <!-- Footer -->
            <div class="px-7 py-5 flex gap-3"
                 style="border-top:1px solid rgba(0,0,0,0.06)">
              <button @click="dismissRollover"
                      class="btn btn-ghost flex-shrink-0">Skip</button>
              <button
                @click="applyRollover"
                :disabled="rolloverSaving"
                class="btn btn-primary flex-1 justify-center"
              >{{ rolloverSaving ? 'Saving…' : 'Confirm choices' }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

  </div>
</template>
