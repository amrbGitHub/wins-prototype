<script setup>
import { ref, onMounted } from 'vue'
import { useApi } from '../composables/useApi.js'
import { Brain, Lightbulb, ChevronDown, Calendar, RefreshCw, Target } from 'lucide-vue-next'

const { apiFetch } = useApi()

const reflections = ref([])
const loading     = ref(true)
const error       = ref('')

onMounted(loadReflections)

async function loadReflections() {
  loading.value = true
  error.value   = ''
  try {
    reflections.value = await apiFetch('/api/reflections')
  } catch (e) {
    error.value = e.message
    reflections.value = []
  } finally {
    loading.value = false
  }
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

function monthLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number)
  return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// Expand/collapse individual reflections
const expanded = ref(new Set())
function toggle(id) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
}
</script>

<template>
  <div class="min-h-screen" style="background:var(--page-bg)">

    <!-- ── Hero Banner ──────────────────────────────────────────────────────────── -->
    <div class="relative overflow-hidden" style="background:linear-gradient(135deg,#be185d 0%,#e11d48 60%,#f43f5e 100%)">
      <div class="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/5 blur-3xl"></div>
      <div class="pointer-events-none absolute -bottom-8 left-1/4 h-40 w-40 rounded-full bg-white/5 blur-2xl"></div>

      <div class="relative mx-auto max-w-4xl px-6 py-10">
        <div class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-5">
            <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 shadow-lg backdrop-blur-sm ring-1 ring-white/20">
              <Brain class="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 class="text-2xl font-extrabold tracking-tight text-white drop-shadow-sm">Reflections</h1>
              <p class="mt-0.5 text-sm font-medium text-rose-200">Your AI-powered weekly progress evaluations.</p>
            </div>
          </div>
          <button
            @click="loadReflections"
            :disabled="loading"
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-white/20 transition hover:bg-white/25 disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
          </button>
        </div>
      </div>
    </div>

    <div class="mx-auto max-w-4xl space-y-5 px-4 py-8">

      <!-- Error -->
      <div v-if="error" class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{{ error }}</div>

      <!-- Loading -->
      <div v-if="loading" class="flex flex-col items-center gap-4 py-20 text-center">
        <div class="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-rose-500"></div>
        <p class="text-sm text-slate-400">Loading reflections…</p>
      </div>

      <!-- Empty state -->
      <div v-else-if="!reflections.length" class="card flex flex-col items-center gap-5 py-20 text-center animate-fade-up">
        <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50">
          <Brain class="h-8 w-8 text-rose-300" />
        </div>
        <div>
          <p class="font-bold text-slate-700">No reflections yet</p>
          <p class="mt-1 max-w-xs text-sm text-slate-400">When you complete a weekly review in the Planner, your evaluations will appear here.</p>
        </div>
      </div>

      <!-- Reflections list -->
      <div v-else class="stagger flex flex-col gap-4">
        <div
          v-for="r in reflections"
          :key="r.id"
          class="card card-hover animate-fade-up overflow-hidden"
        >
          <!-- Card header — always visible -->
          <button
            @click="toggle(r.id)"
            class="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition hover:bg-slate-50/60"
          >
            <div class="flex min-w-0 items-center gap-4">
              <!-- Month icon -->
              <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 shadow-md shadow-rose-500/25">
                <Calendar class="h-5 w-5 text-white" />
              </div>
              <div class="min-w-0">
                <p class="font-bold text-slate-800">{{ monthLabel(r.month) }} Review</p>
                <p class="mt-0.5 text-xs text-slate-400">{{ formatDate(r.createdAt) }}</p>
              </div>
            </div>

            <div class="flex shrink-0 items-center gap-2">
              <span class="hidden rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500 sm:inline-flex">
                {{ r.goalsSnapshot?.length ?? 0 }} {{ (r.goalsSnapshot?.length ?? 0) === 1 ? 'goal' : 'goals' }}
              </span>
              <div
                class="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 transition-all duration-200"
                :class="expanded.has(r.id) ? 'rotate-180 bg-rose-100' : ''"
              >
                <ChevronDown class="h-4 w-4 text-slate-500" :class="expanded.has(r.id) ? '!text-rose-600' : ''" />
              </div>
            </div>
          </button>

          <!-- Expanded content -->
          <div v-if="expanded.has(r.id)" class="border-t border-slate-100 px-6 py-5 flex flex-col gap-5">

            <!-- Goals reviewed -->
            <div v-if="r.goalsSnapshot?.length">
              <p class="mb-2.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                <Target class="h-3.5 w-3.5" />
                Goals reviewed
              </p>
              <div class="flex flex-wrap gap-2">
                <span
                  v-for="g in r.goalsSnapshot"
                  :key="g.id ?? g.title"
                  class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600"
                >{{ g.title }}</span>
              </div>
            </div>

            <!-- Evaluation -->
            <div>
              <p class="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Evaluation</p>
              <div class="rounded-xl border-l-4 border-rose-300 bg-rose-50/50 px-4 py-3">
                <p class="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">{{ r.evaluation }}</p>
              </div>
            </div>

            <!-- Suggestions -->
            <div v-if="r.suggestions?.length">
              <p class="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-600">
                <Lightbulb class="h-3.5 w-3.5" />
                Suggestions
              </p>
              <ul class="flex flex-col gap-2">
                <li
                  v-for="(s, i) in r.suggestions"
                  :key="i"
                  class="flex items-start gap-3 rounded-xl bg-amber-50/70 px-4 py-3 text-sm text-slate-700"
                >
                  <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-600">{{ i + 1 }}</span>
                  {{ s }}
                </li>
              </ul>
            </div>

          </div>
        </div>
      </div>

    </div>
  </div>
</template>
