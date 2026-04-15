<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import { useApi } from '../composables/useApi.js'
import { Trophy, Star, Sparkles, MessageSquare, Copy, RefreshCw, X, CheckCircle2, TrendingUp } from 'lucide-vue-next'

const { apiFetch, apiFetchPublic } = useApi()

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

const groupedByDate = computed(() => {
  const map = {}
  for (const entry of entries.value) {
    if (!entry.analysis?.wins?.length) continue
    const key = entry.date
    if (!map[key]) map[key] = { date: key, wins: [] }
    for (const win of entry.analysis.wins) {
      map[key].wins.push({ ...win, _key: `${entry.id}-${win.id}`, entryId: entry.id, entryType: entry.type, entryDate: entry.date, source: 'journal' })
    }
  }
  return Object.values(map).sort((a, b) => b.date.localeCompare(a.date))
})

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

const totalAchieved = computed(() => achievedByMonth.value.reduce((n, g) => n + g.goals.length, 0))
const totalWins     = computed(() => groupedByDate.value.reduce((n, g) => n + g.wins.length, 0))

const expanded = ref(new Set())
function toggleExpand(key) {
  const s = new Set(expanded.value)
  s.has(key) ? s.delete(key) : s.add(key)
  expanded.value = s
}

const modal = reactive({ open: false, win: null, request: '', loading: false, draft: '', error: '', stage: 'input' })

function openModal(win) {
  Object.assign(modal, { open: true, win, request: '', loading: false, draft: '', error: '', stage: 'input' })
}
function openGoalModal(goal) {
  openModal({ title: goal.title, story: goal.description, evidence: goal.successCriteria || '', celebrationIdeas: [] })
}
function closeModal() { modal.open = false }

async function generateMessage() {
  modal.loading = true; modal.error = ''; modal.draft = ''
  try {
    const data = await apiFetchPublic('/api/generate-message', {
      method: 'POST',
      body: JSON.stringify({ win: modal.win, customRequest: modal.request }),
    })
    modal.draft = data.draft; modal.stage = 'draft'
  } catch (e) {
    modal.error = e?.message ?? String(e)
  } finally {
    modal.loading = false
  }
}

async function copyDraft() {
  if (!modal.draft) return
  await navigator.clipboard.writeText(modal.draft)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

const copied = ref(false)
function regenerate() { modal.stage = 'input'; modal.draft = ''; modal.error = '' }

function formatDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
function formatMonth(ym) {
  const [year, month] = ym.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}
</script>

<template>
  <div class="px-6 py-8 max-w-3xl mx-auto space-y-8">

    <!-- ── Hero Header ──────────────────────────────────────────────── -->
    <div class="relative overflow-hidden rounded-3xl animate-fade-up"
         style="background:linear-gradient(135deg,#b45309 0%,#d97706 40%,#f59e0b 100%)">
      <!-- Decorative blobs -->
      <div class="absolute -top-10 -right-10 h-48 w-48 rounded-full opacity-20"
           style="background:rgba(255,255,255,0.3)"></div>
      <div class="absolute -bottom-6 -left-6 h-32 w-32 rounded-full opacity-10"
           style="background:rgba(255,255,255,0.5)"></div>
      <div class="absolute top-1/2 right-32 h-20 w-20 rounded-full opacity-10"
           style="background:rgba(255,255,255,0.4)"></div>

      <div class="relative px-8 py-9">
        <div class="flex items-start gap-5">
          <div class="h-14 w-14 rounded-2xl shrink-0 flex items-center justify-center shadow-lg animate-float"
               style="background:rgba(255,255,255,0.2);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.3)">
            <Trophy class="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 class="text-2xl font-bold text-white leading-tight">Your Wins</h1>
            <p class="text-amber-100 text-sm mt-1 leading-relaxed max-w-xs">
              Every achievement deserves recognition — goals smashed and moments of brilliance from your journal.
            </p>
          </div>
        </div>

        <!-- Stats chips -->
        <div v-if="totalAchieved || totalWins" class="flex flex-wrap gap-2.5 mt-6">
          <div v-if="totalAchieved" class="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold text-amber-900"
               style="background:rgba(255,255,255,0.25);backdrop-filter:blur(8px)">
            <CheckCircle2 class="h-4 w-4" />
            {{ totalAchieved }} goal{{ totalAchieved === 1 ? '' : 's' }} achieved
          </div>
          <div v-if="totalWins" class="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold text-amber-900"
               style="background:rgba(255,255,255,0.25);backdrop-filter:blur(8px)">
            <Star class="h-4 w-4" />
            {{ totalWins }} journal win{{ totalWins === 1 ? '' : 's' }}
          </div>
        </div>
      </div>
    </div>

    <!-- ── Empty state ───────────────────────────────────────────────── -->
    <div v-if="!achievedByMonth.length && !groupedByDate.length"
         class="card flex flex-col items-center gap-5 px-8 py-16 text-center animate-fade-up">
      <div class="h-20 w-20 rounded-3xl flex items-center justify-center animate-float"
           style="background:linear-gradient(135deg,#fef3c7,#fde68a)">
        <Trophy class="h-10 w-10 text-amber-400" />
      </div>
      <div>
        <p class="text-lg font-bold text-slate-700">No wins yet</p>
        <p class="text-sm text-slate-400 mt-2 max-w-xs leading-relaxed">
          Mark a goal as achieved in <strong>My Goals</strong>, or write a journal entry — your wins will appear here automatically.
        </p>
      </div>
    </div>

    <!-- ── Achieved Goals ─────────────────────────────────────────────── -->
    <section v-if="achievedByMonth.length" class="space-y-6 animate-fade-up stagger">

      <div class="flex items-center gap-3">
        <div class="h-9 w-9 rounded-2xl flex items-center justify-center shadow-sm"
             style="background:linear-gradient(135deg,#7c3aed,#6d28d9)">
          <CheckCircle2 class="h-5 w-5 text-white" />
        </div>
        <h2 class="text-base font-bold text-slate-800">Achieved Goals</h2>
      </div>

      <div v-for="group in achievedByMonth" :key="group.month" class="space-y-3">
        <div class="flex items-center gap-3">
          <span class="text-sm font-bold text-slate-500">{{ formatMonth(group.month) }}</span>
          <div class="flex-1 h-px" style="background:linear-gradient(90deg,rgba(124,58,237,0.2),transparent)"></div>
          <span class="text-xs font-bold text-violet-600 bg-violet-50 border border-violet-200/60 px-3 py-1 rounded-full">
            {{ group.goals.length }} achieved
          </span>
        </div>

        <div v-for="goal in group.goals" :key="goal._key"
             class="card card-hover overflow-hidden group">
          <!-- Accent bar -->
          <div class="absolute top-0 left-0 right-0 h-0.5"
               style="background:linear-gradient(90deg,#7c3aed,#6d28d9)"></div>

          <button @click="toggleExpand(goal._key)"
                  class="relative w-full flex items-center gap-4 px-6 py-5 text-left transition-colors duration-200 hover:bg-slate-50/60">
            <div class="shrink-0 h-12 w-12 rounded-2xl flex items-center justify-center shadow-inner"
                 style="background:linear-gradient(135deg,#ede9fe,#ddd6fe)">
              <CheckCircle2 class="h-6 w-6 text-violet-600" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-base font-bold text-slate-900">{{ goal.title }}</span>
                <span class="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border"
                      style="background:#ede9fe;color:#6d28d9;border-color:rgba(124,58,237,0.2)">
                  Achieved ✓
                </span>
              </div>
              <p v-if="!expanded.has(goal._key)" class="mt-1 text-sm text-slate-500 truncate">{{ goal.description }}</p>
            </div>
            <svg class="h-5 w-5 text-slate-300 transition-transform duration-300 shrink-0"
                 :class="expanded.has(goal._key) ? 'rotate-180' : ''"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          <div v-if="expanded.has(goal._key)" class="border-t border-slate-100/80 px-6 pb-6 pt-5 space-y-5">
            <div class="space-y-4">
              <div v-if="goal.description">
                <p class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">What was achieved</p>
                <p class="text-sm text-slate-700 leading-relaxed pl-4 border-l-2 border-violet-200">{{ goal.description }}</p>
              </div>
              <div v-if="goal.successCriteria">
                <p class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Success criteria met</p>
                <p class="text-sm text-slate-700 leading-relaxed pl-4 border-l-2 border-emerald-200">{{ goal.successCriteria }}</p>
              </div>
            </div>
            <button @click="openGoalModal(goal)"
                    class="btn btn-primary text-sm"
                    style="background:linear-gradient(135deg,#7c3aed,#6d28d9);box-shadow:0 2px 10px rgba(124,58,237,0.3)">
              <MessageSquare class="h-4 w-4" />
              Generate a celebration message
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Journal Wins ───────────────────────────────────────────────── -->
    <section v-if="groupedByDate.length" class="space-y-6 animate-fade-up stagger">

      <div v-if="achievedByMonth.length" class="flex items-center gap-3">
        <div class="h-9 w-9 rounded-2xl flex items-center justify-center shadow-sm"
             style="background:linear-gradient(135deg,#0d5f6b,#0ea5e9)">
          <Star class="h-5 w-5 text-white" />
        </div>
        <h2 class="text-base font-bold text-slate-800">Journal Wins</h2>
      </div>

      <div v-for="group in groupedByDate" :key="group.date" class="space-y-3">
        <div class="flex items-center gap-3">
          <span class="text-sm font-bold text-slate-500">{{ formatDate(group.date) }}</span>
          <div class="flex-1 h-px" style="background:linear-gradient(90deg,rgba(13,95,107,0.2),transparent)"></div>
          <span class="text-xs font-semibold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
            {{ group.wins.length }} win{{ group.wins.length === 1 ? '' : 's' }}
          </span>
        </div>

        <div v-for="win in group.wins" :key="win._key" class="card card-hover overflow-hidden group">
          <div class="absolute top-0 left-0 right-0 h-0.5"
               style="background:linear-gradient(90deg,#0d5f6b,#0ea5e9)"></div>

          <button @click="toggleExpand(win._key)"
                  class="relative w-full flex items-center gap-4 px-6 py-5 text-left hover:bg-slate-50/60 transition-colors duration-200">
            <div class="shrink-0 h-12 w-12 rounded-2xl flex items-center justify-center shadow-inner"
                 style="background:linear-gradient(135deg,#e0f5f7,#ccfbf1)">
              <Star class="h-6 w-6 text-teal-600" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-base font-bold text-slate-900">{{ win.title }}</span>
                <span class="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border"
                      :style="win.entryType === 'weekly'
                        ? 'background:#fef3c7;color:#92400e;border-color:rgba(251,191,36,0.3)'
                        : 'background:#e0f5f7;color:#134e4a;border-color:rgba(13,95,107,0.2)'">
                  {{ win.entryType === 'weekly' ? 'Weekly' : 'Daily' }}
                </span>
              </div>
              <p v-if="!expanded.has(win._key)" class="mt-1 text-sm text-slate-500 truncate">{{ win.story }}</p>
            </div>
            <svg class="h-5 w-5 text-slate-300 transition-transform duration-300 shrink-0"
                 :class="expanded.has(win._key) ? 'rotate-180' : ''"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          <div v-if="expanded.has(win._key)" class="border-t border-slate-100/80 px-6 pb-6 pt-5 space-y-5">
            <div class="space-y-4">
              <div>
                <p class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Story</p>
                <p class="text-sm text-slate-700 leading-relaxed pl-4 border-l-2 border-teal-200">{{ win.story }}</p>
              </div>
              <div>
                <p class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Evidence</p>
                <p class="text-sm text-slate-700 leading-relaxed pl-4 border-l-2 border-emerald-200">{{ win.evidence }}</p>
              </div>
              <div v-if="win.celebrationIdeas?.length">
                <p class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Celebration ideas</p>
                <ul class="space-y-2">
                  <li v-for="(idea, i) in win.celebrationIdeas" :key="i"
                      class="flex items-start gap-3 text-sm text-slate-700 rounded-xl p-3"
                      style="background:#f8fafc;border:1px solid rgba(0,0,0,0.04)">
                    <Sparkles class="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                    {{ idea }}
                  </li>
                </ul>
              </div>
            </div>
            <button @click="openModal(win)" class="btn btn-primary text-sm">
              <MessageSquare class="h-4 w-4" />
              Generate a message for this win
            </button>
          </div>
        </div>
      </div>
    </section>

  </div>

  <!-- ── Generate Message Modal ─────────────────────────────────────── -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition duration-200 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div v-if="modal.open" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
           @click.self="closeModal">
        <div class="absolute inset-0" style="background:rgba(0,0,0,0.45);backdrop-filter:blur(8px)"
             @click="closeModal"></div>

        <div class="relative w-full max-w-lg overflow-hidden rounded-3xl"
             style="background:white;box-shadow:var(--shadow-modal)">

          <!-- Header -->
          <div class="flex items-start justify-between gap-3 px-7 py-6"
               style="border-bottom:1px solid rgba(0,0,0,0.06)">
            <div class="flex items-center gap-3">
              <div class="h-10 w-10 rounded-2xl flex items-center justify-center shrink-0"
                   style="background:linear-gradient(135deg,#0d5f6b,#0ea5e9)">
                <MessageSquare class="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 class="text-base font-bold text-slate-900">Generate a message</h3>
                <p class="text-xs text-slate-500 mt-0.5 line-clamp-1">{{ modal.win?.title }}</p>
              </div>
            </div>
            <button @click="closeModal"
                    class="h-9 w-9 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition shrink-0">
              <X class="h-5 w-5" />
            </button>
          </div>

          <!-- Input stage -->
          <div v-if="modal.stage === 'input'" class="px-7 py-6 space-y-5">
            <div>
              <label class="text-sm font-bold text-slate-700">Any custom requests?</label>
              <p class="text-xs text-slate-400 mt-0.5 mb-3">Leave blank for a warm, professional tone.</p>
              <textarea
                v-model="modal.request"
                rows="4"
                class="input resize-none"
                placeholder="e.g. Keep it short. Address the whole team. Make it celebratory…"
                @keydown.meta.enter="generateMessage"
                @keydown.ctrl.enter="generateMessage"
              />
            </div>
            <div v-if="modal.error"
                 class="rounded-2xl px-4 py-3 text-sm text-rose-700 font-medium"
                 style="background:#fff1f2;border:1px solid rgba(225,29,72,0.15)">
              {{ modal.error }}
            </div>
            <button @click="generateMessage" :disabled="modal.loading" class="btn btn-primary w-full justify-center text-sm py-3">
              <span v-if="modal.loading" class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
              <Sparkles v-else class="h-4 w-4" />
              {{ modal.loading ? 'Writing your message…' : 'Generate message' }}
            </button>
          </div>

          <!-- Draft stage -->
          <div v-else class="px-7 py-6 space-y-5">
            <div>
              <div class="flex items-center justify-between mb-3">
                <label class="text-sm font-bold text-slate-700">Your message</label>
                <button @click="regenerate"
                        class="flex items-center gap-1.5 text-xs font-semibold text-teal-600 hover:text-teal-700 transition">
                  <RefreshCw class="h-3.5 w-3.5" />
                  Regenerate
                </button>
              </div>
              <textarea
                v-model="modal.draft"
                rows="9"
                class="input resize-none"
                style="line-height:1.7"
              />
              <p class="mt-2 text-xs text-slate-400">Edit freely before copying.</p>
            </div>
            <div class="flex gap-3">
              <button @click="copyDraft"
                      class="btn btn-primary flex-1 justify-center text-sm py-3"
                      :style="copied ? 'background:linear-gradient(135deg,#059669,#10b981)' : ''">
                <Copy class="h-4 w-4" />
                {{ copied ? 'Copied!' : 'Copy to clipboard' }}
              </button>
              <button @click="closeModal" class="btn btn-ghost text-sm px-5">Done</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.card { position: relative; }
</style>
