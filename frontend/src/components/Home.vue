<script setup>
// Home — a dashboard, not a tutorial. The previous "STEP 1/2/3/4" stepper
// was useful on day 1 and noise from then on.
//
// Surfaces:
//   - Greeting + primary CTA (talk to LC)
//   - This-month stats strip (goals, wins, entries, last entry)
//   - Reflection-due nudge (if applicable)
//   - Active goals with progress bars
//   - Recent wins
//   - Where-to-go destination grid

import { ref, computed, onMounted } from 'vue'
import { useApi } from '../composables/useApi.js'
import { thisMonthLocal } from '../lib/dates.js'
import {
  Sparkles, Target, Trophy, Brain, ArrowRight, TrendingUp,
  BookOpen, Layers,
} from 'lucide-vue-next'

defineProps({
  firstName: { type: String, default: '' },
})

const emit = defineEmits(['navigate'])

const { apiFetch } = useApi()

const loading = ref(true)
const goals   = ref([])
const recentWins = ref([])
const lastReflection = ref(null)
const entriesThisMonth = ref(0)
const winsThisMonth    = ref(0)
const daysSinceLastEntry = ref(null)

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
})

const activeGoals = computed(() => goals.value.filter(g => g.status === 'active'))
const overallProgress = computed(() => {
  if (!activeGoals.value.length) return 0
  return Math.round(activeGoals.value.reduce((a, g) => a + (g.progress ?? 0), 0) / activeGoals.value.length)
})

const monthLabel = computed(() => {
  const [y, m] = thisMonthLocal().split('-').map(Number)
  return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
})

const todayLabel = computed(() =>
  new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
)

// Reflection-due if no reflection for THIS month and we have goals older than 7d.
const reflectionDue = computed(() => {
  if (!activeGoals.value.length) return false
  const thisMonth = thisMonthLocal()
  if (lastReflection.value?.month === thisMonth) return false
  const oldest = activeGoals.value.reduce((m, g) => Math.min(m, g.createdAt || Infinity), Infinity)
  if (!isFinite(oldest)) return false
  const daysSince = (Date.now() - oldest) / (1000 * 60 * 60 * 24)
  return daysSince >= 7
})

// Destinations grid. Each card stays neutral until hover, then lights up
// with its section's signature color via the .dest-card rules below.
const destinations = [
  { id: 'elsie',       icon: Sparkles, title: 'LC',           desc: 'Talk through your work, set goals, and log wins through conversation.', recommended: true, accent: 'teal'    },
  { id: 'goals',       icon: Target,   title: 'My Goals',     desc: 'See active monthly goals, update progress, and mark milestones.',                        accent: 'emerald' },
  { id: 'journal',     icon: BookOpen, title: 'Journal',      desc: 'Capture daily notes from sessions; wins surface automatically.',                          accent: 'violet'  },
  { id: 'celebrate',   icon: Trophy,   title: 'Celebrate',    desc: 'Browse achieved goals and journal wins; draft recognition messages.',                     accent: 'amber'   },
  { id: 'reflections', icon: Brain,    title: 'Reflections',  desc: 'AI-guided monthly review evaluating each goal with concrete suggestions.',                accent: 'rose'    },
  { id: 'programs',    icon: Layers,   title: 'Programs',     desc: 'Group goals, entries, and reflections by the program they belong to.',                    accent: 'cyan'    },
]

const ACCENT_STYLES = {
  teal:    { from: '#0d5f6b', to: '#2dd4bf', tint: 'rgba(45,212,191,0.08)',  ring: 'rgba(13,95,107,0.35)'  },
  emerald: { from: '#047857', to: '#34d399', tint: 'rgba(52,211,153,0.08)',  ring: 'rgba(4,120,87,0.35)'   },
  violet:  { from: '#6d28d9', to: '#a78bfa', tint: 'rgba(167,139,250,0.08)', ring: 'rgba(109,40,217,0.35)' },
  amber:   { from: '#b45309', to: '#fbbf24', tint: 'rgba(251,191,36,0.08)',  ring: 'rgba(180,83,9,0.35)'   },
  rose:    { from: '#be185d', to: '#fb7185', tint: 'rgba(251,113,133,0.08)', ring: 'rgba(190,24,93,0.35)'  },
  cyan:    { from: '#0e7490', to: '#67e8f9', tint: 'rgba(103,232,249,0.08)', ring: 'rgba(14,116,144,0.35)' },
}

onMounted(async () => {
  loading.value = true
  const month = thisMonthLocal()
  const [g, e, r] = await Promise.allSettled([
    apiFetch(`/api/goals?month=${month}`),
    apiFetch('/api/entries'),
    apiFetch('/api/reflections'),
  ])
  if (g.status === 'fulfilled') goals.value = g.value || []
  if (e.status === 'fulfilled') {
    const allEntries = e.value || []
    const wins = []
    let entryMonthCount = 0
    let winMonthCount = 0
    let latestEntryDate = null
    for (const entry of allEntries) {
      const inMonth = (entry.date || '').startsWith(month)
      if (inMonth) entryMonthCount++
      if (!latestEntryDate || (entry.date || '') > latestEntryDate) latestEntryDate = entry.date
      if (!entry.analysis?.wins?.length) continue
      for (const w of entry.analysis.wins) {
        wins.push({
          date: entry.date,
          entryType: entry.type,
          title: w.title || 'Win',
          story: w.story || '',
        })
        if (inMonth) winMonthCount++
      }
    }
    wins.sort((a, b) => b.date.localeCompare(a.date))
    recentWins.value = wins.slice(0, 4)
    entriesThisMonth.value = entryMonthCount
    winsThisMonth.value    = winMonthCount
    if (latestEntryDate) {
      const diff = Math.floor((Date.now() - new Date(latestEntryDate + 'T12:00:00').getTime()) / 86400000)
      daysSinceLastEntry.value = Math.max(0, diff)
    }
  }
  if (r.status === 'fulfilled') lastReflection.value = (r.value || [])[0] || null
  loading.value = false
})

function fmtDate(s) {
  try { return new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
  catch { return s }
}
</script>

<template>
  <div class="min-h-screen" style="background:var(--page-bg)">

    <!-- Hero -->
    <div class="relative overflow-hidden"
         style="background:linear-gradient(135deg,#0b1a1c 0%,#0d5f6b 55%,#0e8095 100%)">
      <div class="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-white/5 blur-3xl"></div>
      <div class="pointer-events-none absolute bottom-0 left-1/3 h-48 w-48 rounded-full bg-teal-300/8 blur-2xl"></div>

      <div class="relative mx-auto max-w-4xl px-6 py-10">
        <p class="text-sm font-semibold text-teal-300/80 mb-1">
          {{ greeting }}{{ firstName ? `, ${firstName}` : '' }}
        </p>
        <h1 class="text-2xl sm:text-3xl font-extrabold tracking-tight text-white leading-tight">
          {{ todayLabel }}
        </h1>
        <p class="mt-2 text-sm text-white/55 max-w-md leading-relaxed">
          What's been going on with your work this month?
        </p>
        <div class="mt-5 flex flex-wrap gap-3">
          <button
            @click="emit('navigate','elsie')"
            class="btn btn-primary"
            style="background:linear-gradient(135deg,#2dd4bf,#0e8095);box-shadow:0 4px 20px rgba(45,212,191,0.35);font-size:14px;padding:10px 20px"
          >
            <Sparkles class="h-4 w-4" />
            Talk to LC
          </button>
          <button
            @click="emit('navigate','journal')"
            class="btn"
            style="color:white;border:1.5px solid rgba(255,255,255,0.22);background:rgba(255,255,255,0.1);font-size:14px;padding:10px 20px"
          >
            <BookOpen class="h-4 w-4" />
            Journal an entry
          </button>
        </div>
      </div>
    </div>

    <div class="mx-auto max-w-4xl px-4 py-8 space-y-6">

      <!-- This-month-at-a-glance strip -->
      <div v-if="!loading" class="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div class="card px-4 py-3">
          <p class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Active goals</p>
          <p class="text-xl font-extrabold text-slate-800 mt-0.5 leading-none">
            {{ activeGoals.length }}
            <span v-if="activeGoals.length" class="text-xs font-bold text-teal-600 ml-1">{{ overallProgress }}%</span>
          </p>
        </div>
        <div class="card px-4 py-3">
          <p class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Wins this month</p>
          <p class="text-xl font-extrabold text-slate-800 mt-0.5 leading-none">{{ winsThisMonth }}</p>
        </div>
        <div class="card px-4 py-3">
          <p class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Journal entries</p>
          <p class="text-xl font-extrabold text-slate-800 mt-0.5 leading-none">{{ entriesThisMonth }}</p>
        </div>
        <div class="card px-4 py-3">
          <p class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Last entry</p>
          <p class="text-xl font-extrabold text-slate-800 mt-0.5 leading-none">
            <template v-if="daysSinceLastEntry === null">—</template>
            <template v-else-if="daysSinceLastEntry === 0">Today</template>
            <template v-else>{{ daysSinceLastEntry }}d ago</template>
          </p>
        </div>
      </div>

      <!-- Reflection-due nudge -->
      <Transition
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="opacity-0 -translate-y-2"
        enter-to-class="opacity-100 translate-y-0"
      >
        <button
          v-if="reflectionDue"
          @click="emit('navigate','reflections')"
          class="w-full card flex items-center gap-4 px-5 py-4 cursor-pointer transition hover:shadow-md text-left"
        >
          <div class="h-10 w-10 shrink-0 rounded-xl flex items-center justify-center"
               style="background:linear-gradient(135deg,#f59e0b,#f97316)">
            <Brain class="h-5 w-5 text-white" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-bold text-slate-800 text-sm">Monthly review is due</p>
            <p class="text-xs text-slate-500 mt-0.5">Walk through where each goal stands and capture what's next.</p>
          </div>
          <ArrowRight class="h-4 w-4 text-slate-300 shrink-0" />
        </button>
      </Transition>

      <!-- Active goals -->
      <section>
        <div class="flex items-baseline justify-between mb-3">
          <h2 class="text-sm font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Target class="h-4 w-4 text-emerald-600" />
            Active goals
          </h2>
          <button
            @click="emit('navigate','goals')"
            class="text-xs font-semibold text-teal-700 hover:text-teal-900 flex items-center gap-1"
          >
            All goals <ArrowRight class="h-3 w-3" />
          </button>
        </div>

        <div v-if="loading" class="card px-5 py-8 text-center text-xs text-slate-400">Loading…</div>

        <button
          v-else-if="!activeGoals.length"
          @click="emit('navigate','elsie')"
          class="w-full card flex items-center gap-4 px-5 py-4 text-left transition hover:shadow-md"
        >
          <div class="h-10 w-10 shrink-0 rounded-xl flex items-center justify-center"
               style="background:linear-gradient(135deg,#0d5f6b,#0e8095)">
            <Sparkles class="h-5 w-5 text-white" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-bold text-slate-800 text-sm">No goals set yet for {{ monthLabel }}</p>
            <p class="text-xs text-slate-400 mt-0.5">Chat with LC to plan what to focus on — just talk naturally.</p>
          </div>
          <ArrowRight class="h-4 w-4 text-slate-300 shrink-0" />
        </button>

        <div v-else class="space-y-2">
          <div class="card px-5 py-3 flex items-center gap-3">
            <TrendingUp class="h-4 w-4 text-teal-600 shrink-0" />
            <p class="text-xs text-slate-600 flex-1">
              {{ activeGoals.length }} active goal{{ activeGoals.length === 1 ? '' : 's' }} ·
              <span class="font-semibold text-slate-800">{{ overallProgress }}%</span> overall
            </p>
          </div>
          <button
            v-for="g in activeGoals.slice(0, 4)"
            :key="g.id"
            @click="emit('navigate','goals')"
            class="w-full card px-5 py-3 text-left transition hover:shadow-md"
          >
            <div class="flex items-center gap-3">
              <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-slate-800 truncate">{{ g.title }}</p>
                <div class="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div class="h-full rounded-full transition-all"
                       :style="`width:${g.progress || 0}%;background:linear-gradient(90deg,#0d5f6b,#2dd4bf)`"></div>
                </div>
              </div>
              <span class="text-xs font-bold text-slate-500 shrink-0">{{ g.progress || 0 }}%</span>
            </div>
          </button>
          <p v-if="activeGoals.length > 4" class="text-[11px] text-slate-400 text-center pt-1">
            + {{ activeGoals.length - 4 }} more on the Goals page
          </p>
        </div>
      </section>

      <!-- Recent wins -->
      <section v-if="!loading && recentWins.length">
        <div class="flex items-baseline justify-between mb-3">
          <h2 class="text-sm font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Trophy class="h-4 w-4 text-amber-500" />
            Recent wins
          </h2>
          <button
            @click="emit('navigate','celebrate')"
            class="text-xs font-semibold text-teal-700 hover:text-teal-900 flex items-center gap-1"
          >
            Celebrate <ArrowRight class="h-3 w-3" />
          </button>
        </div>
        <div class="space-y-2">
          <div
            v-for="(w, i) in recentWins"
            :key="i"
            class="card px-5 py-3 flex items-start gap-3"
          >
            <div class="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center"
                 style="background:linear-gradient(135deg,#fef3c7,#fde68a)">
              <Trophy class="h-4 w-4 text-amber-600" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-slate-800 truncate">{{ w.title }}</p>
              <p class="text-[11px] text-slate-400 mt-0.5">{{ fmtDate(w.date) }} · {{ w.entryType }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Where to go -->
      <section>
        <h2 class="text-sm font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
          Where to go from here
        </h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <button
            v-for="d in destinations"
            :key="d.id"
            @click="emit('navigate', d.id)"
            class="dest-card card px-4 py-4 text-left relative"
            :style="{
              '--accent-from': ACCENT_STYLES[d.accent].from,
              '--accent-to':   ACCENT_STYLES[d.accent].to,
              '--accent-tint': ACCENT_STYLES[d.accent].tint,
              '--accent-ring': ACCENT_STYLES[d.accent].ring,
            }"
          >
            <div class="flex items-center gap-3 mb-2">
              <div class="dest-card__icon h-9 w-9 rounded-lg flex items-center justify-center bg-slate-100 transition-all duration-200">
                <component :is="d.icon" class="dest-card__icon-svg h-4 w-4 text-slate-600 transition-colors duration-200" />
              </div>
              <p class="font-bold text-slate-800 text-sm flex-1">{{ d.title }}</p>
              <span
                v-if="d.recommended"
                class="text-[9px] font-bold rounded-full px-1.5 py-0.5"
                style="background:rgba(13,95,107,0.1);color:#0d5f6b"
              >Recommended</span>
            </div>
            <p class="text-[11px] text-slate-500 leading-relaxed">{{ d.desc }}</p>
          </button>
        </div>
      </section>

    </div>
  </div>
</template>

<style scoped>
/* Destination card hover — the card lifts and lights up with its section's
   accent color (the --accent-* vars are set inline per-card). */
.dest-card {
  transition:
    transform 200ms ease,
    box-shadow 200ms ease,
    background 200ms ease,
    border-color 200ms ease;
  border: 1px solid transparent;
}
.dest-card:hover {
  transform: translateY(-3px) scale(1.015);
  background: var(--accent-tint);
  border-color: var(--accent-ring);
  box-shadow: 0 10px 28px var(--accent-ring);
}
.dest-card:hover .dest-card__icon {
  background: linear-gradient(135deg, var(--accent-from), var(--accent-to));
  box-shadow: 0 4px 14px var(--accent-ring);
  transform: scale(1.05);
}
.dest-card:hover .dest-card__icon-svg {
  color: #ffffff;
}
.dest-card:active {
  transform: translateY(-1px) scale(1.0);
}
</style>
