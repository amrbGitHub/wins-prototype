<script setup>
import { ref, onMounted, computed } from 'vue'
import { useApi } from '../composables/useApi.js'
import { thisMonthLocal } from '../lib/dates.js'
import { Sparkles, Target, Trophy, TrendingUp, ArrowRight, Brain } from 'lucide-vue-next'

const props = defineProps({
  firstName: { type: String, default: '' },
})

const emit = defineEmits(['navigate'])

const { apiFetch } = useApi()

const goalCount   = ref(0)
const statsLoaded = ref(false)

onMounted(async () => {
  try {
    const goals     = await apiFetch(`/api/goals?month=${thisMonthLocal()}`)
    goalCount.value = (goals || []).filter(g => g.status === 'active').length
  } catch { /* non-critical */ } finally {
    statsLoaded.value = true
  }
})

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
})

const steps = [
  {
    id:    'elsie',
    icon:  Sparkles,
    title: 'Chat with LC',
    desc:  'Your Learning Companion. Set goals, log wins, update progress — all through natural conversation.',
    bg:    'linear-gradient(135deg,#0d5f6b,#0e8095)',
    ring:  'rgba(13,95,107,0.35)',
    glow:  'rgba(13,95,107,0.18)',
    badge: { text: 'AI', color: 'bg-teal-100 text-teal-700' },
  },
  {
    id:    'goals',
    icon:  Target,
    title: 'Track Goals',
    desc:  'View your monthly goals, update milestones, and watch your progress grow.',
    bg:    'linear-gradient(135deg,#0891b2,#0ea5e9)',
    ring:  'rgba(8,145,178,0.30)',
    glow:  'rgba(8,145,178,0.14)',
    badge: null,
  },
  {
    id:    'celebrate',
    icon:  Trophy,
    title: 'Celebrate Wins',
    desc:  'Recognise achievements and share celebration messages with your learners and team.',
    bg:    'linear-gradient(135deg,#d97706,#f59e0b)',
    ring:  'rgba(217,119,6,0.28)',
    glow:  'rgba(217,119,6,0.14)',
    badge: null,
  },
  {
    id:    'reflections',
    icon:  Brain,
    title: 'Monthly Review',
    desc:  'Reflect on what worked, what didn\'t, and carry momentum into the next month.',
    bg:    'linear-gradient(135deg,#e11d48,#f43f5e)',
    ring:  'rgba(225,29,72,0.28)',
    glow:  'rgba(225,29,72,0.14)',
    badge: { text: 'Monthly', color: 'bg-rose-100 text-rose-700' },
  },
]
</script>

<template>
  <div class="min-h-screen" style="background:var(--page-bg)">

    <!-- ── Hero ───────────────────────────────────────────────────────────────── -->
    <div class="relative overflow-hidden"
         style="background:linear-gradient(135deg,#0b1a1c 0%,#0d5f6b 55%,#0e8095 100%)">
      <div class="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-white/5 blur-3xl"></div>
      <div class="pointer-events-none absolute bottom-0 left-1/3 h-48 w-48 rounded-full bg-teal-300/8 blur-2xl"></div>

      <div class="relative mx-auto max-w-4xl px-6 py-12">
        <div class="flex flex-col gap-6 animate-fade-up">
          <div>
            <p class="text-sm font-semibold text-teal-300/80 mb-1">
              {{ greeting }}{{ firstName ? `, ${firstName}` : '' }} 👋
            </p>
            <h1 class="text-3xl font-extrabold tracking-tight text-white leading-tight">
              Welcome to
              <span style="-webkit-background-clip:text;-webkit-text-fill-color:transparent;background:linear-gradient(90deg,#2dd4bf,#67e8f9);background-clip:text">
                Celebrating&nbsp;Wins
              </span>
            </h1>
            <p class="mt-2.5 text-sm text-white/55 max-w-md leading-relaxed">
              Your companion for daily check-ins, goal tracking, and celebrating every win along the way.
            </p>
          </div>

          <div class="flex flex-wrap gap-3" style="animation-delay:80ms">
            <button
              @click="emit('navigate','elsie')"
              class="btn btn-primary"
              style="background:linear-gradient(135deg,#2dd4bf,#0e8095);box-shadow:0 4px 20px rgba(45,212,191,0.35);font-size:15px;padding:12px 24px"
            >
              <Sparkles class="h-4 w-4" />
              Talk to LC
            </button>
            <button
              @click="emit('navigate','goals')"
              class="btn"
              style="color:white;border:1.5px solid rgba(255,255,255,0.22);background:rgba(255,255,255,0.1);font-size:15px;padding:12px 24px"
            >
              My Goals
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="mx-auto max-w-4xl px-4 py-8 space-y-10">

      <!-- Quick goal banner -->
      <Transition
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="opacity-0 -translate-y-2"
        enter-to-class="opacity-100 translate-y-0"
      >
        <div
          v-if="statsLoaded && goalCount > 0"
          class="card flex items-center gap-4 px-5 py-4 cursor-pointer transition hover:shadow-md"
          @click="emit('navigate','goals')"
        >
          <div class="h-10 w-10 shrink-0 rounded-xl flex items-center justify-center"
               style="background:linear-gradient(135deg,#0d5f6b,#0ea5e9)">
            <TrendingUp class="h-5 w-5 text-white" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-bold text-slate-800 text-sm">
              You have
              <span class="gradient-text">{{ goalCount }} active {{ goalCount === 1 ? 'goal' : 'goals' }}</span>
              this month
            </p>
            <p class="text-xs text-slate-400 mt-0.5">Check in with LC to log progress and celebrate wins</p>
          </div>
          <ArrowRight class="h-4 w-4 text-slate-300 shrink-0" />
        </div>

        <div
          v-else-if="statsLoaded && goalCount === 0"
          class="card flex items-center gap-4 px-5 py-4 cursor-pointer transition hover:shadow-md"
          @click="emit('navigate','elsie')"
        >
          <div class="h-10 w-10 shrink-0 rounded-xl flex items-center justify-center"
               style="background:linear-gradient(135deg,#0d5f6b,#0e8095)">
            <Sparkles class="h-5 w-5 text-white" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-bold text-slate-800 text-sm">No goals set yet for this month</p>
            <p class="text-xs text-slate-400 mt-0.5">Chat with LC to plan your goals — just talk naturally</p>
          </div>
          <ArrowRight class="h-4 w-4 text-slate-300 shrink-0" />
        </div>
      </Transition>

      <!-- ── Explore (feature tiles) ───────────────────────────────────────────
           Previously presented as a numbered "Your workflow" stepper with
           dashed connectors, which read as a required sequence. The app
           doesn't enforce one — each tile is just an entry point. Tiles
           dropped the numbering + connector line to remove that implication. -->
      <div>
        <p class="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-6 px-1">Explore</p>

        <!-- DESKTOP: feature tile grid -->
        <div class="hidden sm:block">
          <div class="grid grid-cols-4 gap-4">
            <button
              v-for="step in steps"
              :key="step.id"
              @click="emit('navigate', step.id)"
              class="group flex flex-col items-center text-center gap-3 cursor-pointer"
            >
              <div
                class="h-[72px] w-[72px] rounded-2xl flex items-center justify-center shadow-lg transition-all duration-300 group-hover:scale-110 group-hover:-translate-y-1 bg-white"
                :style="`box-shadow: 0 4px 16px ${step.glow}, 0 0 0 3px white`"
              >
                <div
                  class="h-full w-full rounded-2xl flex items-center justify-center"
                  :style="`background:${step.bg};box-shadow:0 4px 16px ${step.ring}`"
                >
                  <component :is="step.icon" class="h-8 w-8 text-white" />
                </div>
              </div>

              <div v-if="step.badge" class="flex items-center">
                <span
                  class="text-[9px] font-bold rounded-full px-1.5 py-0.5"
                  :class="step.badge.color"
                >{{ step.badge.text }}</span>
              </div>

              <p class="font-bold text-slate-800 text-sm leading-tight group-hover:text-teal-700 transition-colors duration-200">
                {{ step.title }}
              </p>

              <p class="text-[11px] text-slate-400 leading-relaxed px-1">{{ step.desc }}</p>
            </button>
          </div>
        </div>

        <!-- MOBILE: vertical stack -->
        <div class="sm:hidden flex flex-col gap-3">
          <button
            v-for="step in steps"
            :key="step.id"
            @click="emit('navigate', step.id)"
            class="flex items-start gap-4 text-left rounded-2xl bg-white border border-slate-100 shadow-sm px-4 py-3 active:scale-[0.99] transition"
          >
            <div
              class="shrink-0 h-[56px] w-[56px] rounded-xl flex items-center justify-center"
              :style="`background:${step.bg};box-shadow:0 4px 12px ${step.ring}`"
            >
              <component :is="step.icon" class="h-7 w-7 text-white" />
            </div>
            <div class="flex-1 pt-0.5">
              <div class="flex items-center gap-2 mb-0.5">
                <p class="font-bold text-slate-800 text-sm">{{ step.title }}</p>
                <span
                  v-if="step.badge"
                  class="text-[9px] font-bold rounded-full px-1.5 py-0.5"
                  :class="step.badge.color"
                >{{ step.badge.text }}</span>
              </div>
              <p class="text-[11px] text-slate-400 leading-relaxed">{{ step.desc }}</p>
            </div>
          </button>
        </div>
      </div>

    </div>
  </div>
</template>
