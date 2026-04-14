<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import { useApi } from '../composables/useApi.js'

const { apiFetch, apiFetchPublic } = useApi()

// ── Data ────────────────────────────────────────────────────────────
const entries = ref([])
const goals   = ref([])

async function loadEntries() {
  const [e, g] = await Promise.allSettled([
    apiFetch('/api/entries'),
    apiFetch('/api/goals'),
  ])
  entries.value = e.status === 'fulfilled' ? e.value : []
  goals.value   = g.status === 'fulfilled' ? g.value : []
}

onMounted(loadEntries)

// ── Journal wins grouped by date ─────────────────────────────────────
const groupedByDate = computed(() => {
  const map = {}
  for (const entry of entries.value) {
    if (!entry.analysis?.wins?.length) continue
    const key = entry.date
    if (!map[key]) map[key] = { date: key, wins: [] }
    for (const win of entry.analysis.wins) {
      map[key].wins.push({
        ...win,
        _key:      `${entry.id}-${win.id}`,
        entryId:   entry.id,
        entryType: entry.type,
        entryDate: entry.date,
        source:    'journal',
      })
    }
  }
  return Object.values(map).sort((a, b) => b.date.localeCompare(a.date))
})

// ── Achieved goals grouped by month ──────────────────────────────────
const achievedByMonth = computed(() => {
  const map = {}
  for (const goal of goals.value) {
    if (goal.status !== 'achieved') continue
    const key = goal.month
    if (!map[key]) map[key] = { month: key, goals: [] }
    map[key].goals.push({ ...goal, _key: `goal-${goal.id}`, source: 'goal' })
  }
  return Object.values(map).sort((a, b) => b.month.localeCompare(a.month))
})

const totalAchieved = computed(() =>
  achievedByMonth.value.reduce((n, g) => n + g.goals.length, 0)
)

const totalWins = computed(() =>
  groupedByDate.value.reduce((n, g) => n + g.wins.length, 0)
)

// ── Expand / collapse cards ──────────────────────────────────────────
const expanded = ref(new Set())

function toggleExpand(key) {
  const s = new Set(expanded.value)
  s.has(key) ? s.delete(key) : s.add(key)
  expanded.value = s
}

// ── Generate-message modal ───────────────────────────────────────────
const modal = reactive({
  open:    false,
  win:     null,
  request: '',
  loading: false,
  draft:   '',
  error:   '',
  stage:   'input',
})

function openModal(win) {
  modal.open    = true
  modal.win     = win
  modal.request = ''
  modal.loading = false
  modal.draft   = ''
  modal.error   = ''
  modal.stage   = 'input'
}

function closeModal() { modal.open = false }

function openGoalModal(goal) {
  openModal({
    title:            goal.title,
    story:            goal.description,
    evidence:         goal.successCriteria || '',
    celebrationIdeas: [],
  })
}

async function generateMessage() {
  modal.loading = true
  modal.error   = ''
  modal.draft   = ''
  try {
    const data = await apiFetchPublic('/api/generate-message', {
      method: 'POST',
      body: JSON.stringify({ win: modal.win, customRequest: modal.request }),
    })
    modal.draft = data.draft
    modal.stage = 'draft'
  } catch (e) {
    modal.error = e?.message ?? String(e)
  } finally {
    modal.loading = false
  }
}

async function copyDraft() {
  if (!modal.draft) return
  await navigator.clipboard.writeText(modal.draft)
  alert('Copied to clipboard')
}

function regenerate() {
  modal.stage = 'input'
  modal.draft = ''
  modal.error = ''
}

// ── Helpers ──────────────────────────────────────────────────────────
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function formatMonth(ym) {
  const [year, month] = ym.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

const typePill = {
  daily:  'border-teal-200 bg-teal-50 text-teal-700',
  weekly: 'border-amber-200 bg-amber-50 text-amber-700',
}
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-8 space-y-10">

    <!-- Page header -->
    <div class="flex items-end justify-between">
      <div>
        <h2 class="text-2xl font-bold text-slate-900">
          <span class="bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] bg-clip-text text-transparent">Your Wins</span>
        </h2>
        <p class="mt-2 text-sm text-slate-500 font-medium">
          Achieved goals and wins from your journal — all in one place.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="totalAchieved" class="rounded-2xl border border-violet-200/60 bg-gradient-to-r from-violet-50 to-purple-50 px-4 py-2 text-sm font-bold text-violet-700 shadow-sm">
          {{ totalAchieved }} goal{{ totalAchieved === 1 ? '' : 's' }} achieved
        </span>
        <span v-if="totalWins" class="rounded-2xl border border-emerald-200/60 bg-gradient-to-r from-emerald-50 to-teal-50 px-4 py-2 text-sm font-bold text-emerald-700 shadow-sm">
          {{ totalWins }} journal win{{ totalWins === 1 ? '' : 's' }}
        </span>
      </div>
    </div>

    <!-- Empty state -->
    <div
      v-if="!achievedByMonth.length && !groupedByDate.length"
      class="relative overflow-hidden rounded-3xl border border-dashed border-slate-200/60 bg-gradient-to-br from-slate-50 to-white px-6 py-16 text-center"
    >
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(13,95,107,0.05),transparent_50%)]"></div>
      <div class="relative">
        <div class="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-teal-50 to-emerald-50 shadow-inner">
          <svg class="h-8 w-8 text-[#0d5f6b]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"/>
          </svg>
        </div>
        <p class="text-base font-bold text-slate-700">No wins yet</p>
        <p class="mt-2 text-sm text-slate-400 max-w-sm mx-auto">Mark a goal as achieved in My Goals, or write a journal entry — wins will appear here automatically.</p>
      </div>
    </div>

    <!-- ── Achieved Goals section ───────────────────────────────────── -->
    <section v-if="achievedByMonth.length" class="space-y-6">
      <div class="flex items-center gap-3">
        <div class="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-sm flex-shrink-0">
          <svg class="h-4 w-4 text-white" viewBox="0 0 24 24" fill="currentColor">
            <path fill-rule="evenodd" d="M8.603 3.799A4.49 4.49 0 0 1 12 2.25c1.357 0 2.573.6 3.397 1.549a4.49 4.49 0 0 1 3.498 1.307 4.491 4.491 0 0 1 1.307 3.497A4.49 4.49 0 0 1 21.75 12a4.49 4.49 0 0 1-1.549 3.397 4.491 4.491 0 0 1-1.307 3.497 4.491 4.491 0 0 1-3.497 1.307A4.49 4.49 0 0 1 12 21.75a4.49 4.49 0 0 1-3.397-1.549 4.491 4.491 0 0 1-3.497-1.307 4.491 4.491 0 0 1-1.307-3.497A4.49 4.49 0 0 1 2.25 12a4.49 4.49 0 0 1 1.549-3.397 4.491 4.491 0 0 1 1.307-3.497 4.491 4.491 0 0 1 3.497-1.307Zm7.007 6.387a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clip-rule="evenodd"/>
          </svg>
        </div>
        <h3 class="text-base font-bold text-slate-800">Achieved Goals</h3>
      </div>

      <div v-for="group in achievedByMonth" :key="group.month" class="space-y-3">
        <!-- Month header -->
        <div class="flex items-center gap-4">
          <h4 class="text-sm font-bold text-slate-600">{{ formatMonth(group.month) }}</h4>
          <div class="h-px flex-1 bg-gradient-to-r from-violet-200/60 to-transparent"></div>
          <span class="shrink-0 text-xs font-semibold text-violet-600 bg-violet-50 border border-violet-200/60 px-3 py-1 rounded-full">
            {{ group.goals.length }} achieved
          </span>
        </div>

        <!-- Goal cards -->
        <div
          v-for="goal in group.goals"
          :key="goal._key"
          class="group relative overflow-hidden rounded-3xl border border-violet-200/40 bg-white shadow-sm hover:shadow-xl hover:shadow-violet-100/50 transition-all duration-300"
        >
          <div class="absolute inset-0 bg-gradient-to-br from-violet-50/0 via-white to-purple-50/0 group-hover:from-violet-50/20 group-hover:to-purple-50/10 transition-all duration-300"></div>

          <!-- Collapsed header -->
          <button
            @click="toggleExpand(goal._key)"
            class="relative w-full flex items-center gap-4 px-6 py-5 text-left hover:bg-slate-50/50 transition duration-200"
          >
            <div class="shrink-0 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-violet-50 to-purple-50 shadow-inner">
              <svg class="h-5 w-5 text-violet-600" viewBox="0 0 24 24" fill="currentColor">
                <path fill-rule="evenodd" d="M8.603 3.799A4.49 4.49 0 0 1 12 2.25c1.357 0 2.573.6 3.397 1.549a4.49 4.49 0 0 1 3.498 1.307 4.491 4.491 0 0 1 1.307 3.497A4.49 4.49 0 0 1 21.75 12a4.49 4.49 0 0 1-1.549 3.397 4.491 4.491 0 0 1-1.307 3.497 4.491 4.491 0 0 1-3.497 1.307A4.49 4.49 0 0 1 12 21.75a4.49 4.49 0 0 1-3.397-1.549 4.491 4.491 0 0 1-3.497-1.307 4.491 4.491 0 0 1-1.307-3.497A4.49 4.49 0 0 1 2.25 12a4.49 4.49 0 0 1 1.549-3.397 4.491 4.491 0 0 1 1.307-3.497 4.491 4.491 0 0 1 3.497-1.307Zm7.007 6.387a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clip-rule="evenodd"/>
              </svg>
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-base font-bold text-slate-900">{{ goal.title }}</span>
                <span class="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-violet-700">
                  Goal achieved
                </span>
              </div>
              <p v-if="!expanded.has(goal._key)" class="mt-1 text-sm text-slate-500 truncate">{{ goal.description }}</p>
            </div>

            <svg
              class="shrink-0 h-5 w-5 text-slate-400 transition-transform duration-300"
              :class="expanded.has(goal._key) ? 'rotate-180' : ''"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            >
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          <!-- Expanded detail -->
          <div v-if="expanded.has(goal._key)" class="relative border-t border-slate-100/60 px-6 pb-6 pt-4 space-y-5">
            <div class="space-y-4">
              <div v-if="goal.description" class="relative">
                <p class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-2">
                  <span class="h-1.5 w-1.5 rounded-full bg-violet-500"></span>
                  What was achieved
                </p>
                <p class="text-sm text-slate-700 leading-relaxed pl-4 border-l-2 border-violet-200/60">{{ goal.description }}</p>
              </div>
              <div v-if="goal.successCriteria" class="relative">
                <p class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-2">
                  <span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                  Success criteria met
                </p>
                <p class="text-sm text-slate-700 leading-relaxed pl-4 border-l-2 border-emerald-200/60">{{ goal.successCriteria }}</p>
              </div>
            </div>

            <button
              @click="openGoalModal(goal)"
              class="inline-flex items-center gap-2.5 rounded-2xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700
                     px-5 py-3 text-sm font-bold text-white shadow-lg shadow-violet-500/25 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            >
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"/>
              </svg>
              Generate a celebration message
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Journal Wins section ──────────────────────────────────────── -->
    <section v-if="groupedByDate.length" class="space-y-6">
      <div v-if="achievedByMonth.length" class="flex items-center gap-3">
        <div class="h-8 w-8 rounded-xl bg-gradient-to-br from-[#0d5f6b] to-[#0a4a54] flex items-center justify-center shadow-sm flex-shrink-0">
          <svg class="h-4 w-4 text-white" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"/>
          </svg>
        </div>
        <h3 class="text-base font-bold text-slate-800">Journal Wins</h3>
      </div>

      <!-- Date groups -->
      <div v-for="group in groupedByDate" :key="group.date" class="space-y-4">
        <div class="flex items-center gap-4">
          <h4 class="text-sm font-bold text-slate-700">{{ formatDate(group.date) }}</h4>
          <div class="h-px flex-1 bg-gradient-to-r from-slate-200 to-transparent"></div>
          <span class="shrink-0 text-xs font-semibold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">{{ group.wins.length }} win{{ group.wins.length === 1 ? '' : 's' }}</span>
        </div>

        <!-- Win cards -->
        <div
          v-for="win in group.wins"
          :key="win._key"
          class="group relative overflow-hidden rounded-3xl border border-slate-200/60 bg-white shadow-sm hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-300"
        >
          <div class="absolute inset-0 bg-gradient-to-br from-teal-50/0 via-white to-emerald-50/0 group-hover:from-teal-50/30 group-hover:via-white group-hover:to-emerald-50/20 transition-all duration-300"></div>

          <button
            @click="toggleExpand(win._key)"
            class="relative w-full flex items-center gap-4 px-6 py-5 text-left hover:bg-slate-50/50 transition duration-200"
          >
            <div class="shrink-0 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-teal-50 to-emerald-50 shadow-inner">
              <svg class="h-5 w-5 text-[#0d5f6b]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"/>
              </svg>
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-base font-bold text-slate-900">{{ win.title }}</span>
                <span
                  class="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
                  :class="typePill[win.entryType] ?? 'border-slate-200 bg-slate-50 text-slate-600'"
                >
                  {{ win.entryType === 'weekly' ? 'Weekly' : 'Daily' }}
                </span>
              </div>
              <p v-if="!expanded.has(win._key)" class="mt-1 text-sm text-slate-500 truncate">{{ win.story }}</p>
            </div>

            <svg
              class="shrink-0 h-5 w-5 text-slate-400 transition-transform duration-300"
              :class="expanded.has(win._key) ? 'rotate-180' : ''"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            >
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          <div v-if="expanded.has(win._key)" class="relative border-t border-slate-100/60 px-6 pb-6 pt-4 space-y-5">
            <div class="space-y-4">
              <div class="relative">
                <p class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-2">
                  <span class="h-1.5 w-1.5 rounded-full bg-[#0d5f6b]"></span>
                  Story
                </p>
                <p class="text-sm text-slate-700 leading-relaxed pl-4 border-l-2 border-teal-200/60">{{ win.story }}</p>
              </div>
              <div class="relative">
                <p class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-2">
                  <span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                  Evidence
                </p>
                <p class="text-sm text-slate-700 leading-relaxed pl-4 border-l-2 border-emerald-200/60">{{ win.evidence }}</p>
              </div>
              <div v-if="win.celebrationIdeas?.length">
                <p class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
                  <span class="h-1.5 w-1.5 rounded-full bg-amber-400"></span>
                  Celebration ideas
                </p>
                <ul class="space-y-2.5">
                  <li
                    v-for="(idea, i) in win.celebrationIdeas"
                    :key="i"
                    class="flex items-start gap-3 text-sm text-slate-700 bg-slate-50/50 rounded-xl p-3"
                  >
                    <span class="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-gradient-to-br from-[#0d5f6b] to-teal-400"></span>
                    {{ idea }}
                  </li>
                </ul>
              </div>
            </div>

            <button
              @click="openModal(win)"
              class="inline-flex items-center gap-2.5 rounded-2xl bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] hover:from-[#0b5060] hover:to-[#0a4a54]
                     px-5 py-3 text-sm font-bold text-white shadow-lg shadow-[#0d5f6b]/25 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            >
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"/>
              </svg>
              Generate a message for this win
            </button>
          </div>
        </div>
      </div>
    </section>

  </div>

  <!-- ── Modal ──────────────────────────────────────────────────────── -->
  <Teleport to="body">
    <div
      v-if="modal.open"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      @click.self="closeModal"
    >
      <div class="absolute inset-0 bg-slate-900/30 backdrop-blur-md" @click="closeModal"></div>

      <div class="relative w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200/60 bg-white shadow-2xl">
        <div class="absolute inset-0 bg-gradient-to-br from-white via-slate-50 to-teal-50/20"></div>

        <div class="relative flex items-start justify-between gap-3 border-b border-slate-100/60 px-7 py-6">
          <div>
            <h3 class="text-lg font-bold text-slate-900">Generate a message</h3>
            <p class="mt-1 text-sm text-slate-500 line-clamp-1 font-medium">{{ modal.win?.title }}</p>
          </div>
          <button
            @click="closeModal"
            class="shrink-0 rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div v-if="modal.stage === 'input'" class="relative px-7 py-6 space-y-5">
          <div>
            <label class="text-sm font-bold text-slate-700">Any custom requests for this message?</label>
            <p class="mt-1 text-xs text-slate-400">Leave blank for a professional, warm, and encouraging tone.</p>
            <textarea
              v-model="modal.request"
              rows="4"
              class="mt-3 w-full rounded-2xl border border-slate-200/60 bg-white/80 px-4 py-3 text-sm shadow-sm
                     focus:border-[#0d5f6b]/40 focus:ring-4 focus:ring-[#0d5f6b]/10 focus:outline-none resize-none transition"
              placeholder="e.g. Keep it short. Address it to the whole team. Make it feel celebratory…"
              @keydown.meta.enter="generateMessage"
              @keydown.ctrl.enter="generateMessage"
            />
          </div>

          <div v-if="modal.error" class="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-sm text-rose-800">
            <span class="font-bold">Error:</span> {{ modal.error }}
          </div>

          <button
            @click="generateMessage"
            :disabled="modal.loading"
            class="inline-flex w-full items-center justify-center gap-2.5 rounded-2xl
                   bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] hover:from-[#0b5060] hover:to-[#0a4a54] px-5 py-3.5 text-sm font-bold text-white
                   shadow-lg shadow-[#0d5f6b]/25 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
          >
            <span v-if="modal.loading" class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
            {{ modal.loading ? 'Writing your message…' : 'Generate message' }}
          </button>
        </div>

        <div v-else class="relative px-7 py-6 space-y-5">
          <div>
            <div class="flex items-center justify-between mb-3">
              <label class="text-sm font-bold text-slate-700">Your message</label>
              <button
                @click="regenerate"
                class="text-xs text-[#0d5f6b] hover:text-[#0a4a54] transition underline underline-offset-2 font-semibold"
              >Regenerate</button>
            </div>
            <textarea
              v-model="modal.draft"
              rows="10"
              class="w-full rounded-2xl border border-slate-200/60 bg-white/80 px-4 py-3 text-sm shadow-sm
                     focus:border-slate-300 focus:ring-4 focus:ring-slate-100 focus:outline-none"
            />
            <p class="mt-2 text-xs text-slate-400">Edit freely before copying.</p>
          </div>

          <div class="flex items-center gap-3">
            <button
              @click="copyDraft"
              class="inline-flex flex-1 items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-800 px-5 py-3.5
                     text-sm font-bold text-white shadow-lg shadow-slate-900/20 transition-all duration-200 hover:scale-[1.01] hover:from-slate-800 hover:to-slate-700"
            >
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              Copy to clipboard
            </button>
            <button
              @click="closeModal"
              class="rounded-2xl border border-slate-200/60 bg-white/80 px-5 py-3.5 text-sm font-bold text-slate-600 hover:bg-slate-50 transition"
            >Done</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
