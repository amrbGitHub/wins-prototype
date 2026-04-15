<script setup>
import { ref, onMounted, computed } from 'vue'
import { useApi } from '../composables/useApi.js'
import {
  Target, CheckCircle2, Archive, Trash2, ChevronDown,
  Sparkles, RefreshCw, Calendar, TrendingUp, Play,
  Plus, X, PenLine, CalendarDays,
} from 'lucide-vue-next'

const emit = defineEmits(['navigate'])

const { apiFetch } = useApi()

const goals           = ref([])
const loading         = ref(true)
const generatingSteps = ref(new Set())
const expanded        = ref(new Set())
const month           = ref(new Date().toISOString().slice(0, 7))

// ── Manual goal creation ───────────────────────────────────────────────────
const showAddForm  = ref(false)
const addingSaving = ref(false)
const addError     = ref('')
const newGoal      = ref({ title: '', description: '' })

function openAddForm() {
  newGoal.value  = { title: '', description: '' }
  addError.value = ''
  showAddForm.value = true
}

function cancelAdd() {
  showAddForm.value = false
}

async function saveNewGoal() {
  if (!newGoal.value.title.trim()) return
  addingSaving.value = true
  addError.value     = ''
  try {
    const created = await apiFetch('/api/goals', {
      method: 'POST',
      body: JSON.stringify({ title: newGoal.value.title.trim(), description: newGoal.value.description.trim(), month: month.value }),
    })
    goals.value.push(created)
    showAddForm.value = false
  } catch (e) {
    addError.value = e.message
  } finally {
    addingSaving.value = false
  }
}

const monthLabel = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
})

const activeGoals   = computed(() => goals.value.filter(g => g.status === 'active'))
const achievedGoals = computed(() => goals.value.filter(g => g.status === 'achieved'))
const shelvedGoals  = computed(() => goals.value.filter(g => g.status === 'shelved'))

const overallProgress = computed(() => {
  if (!goals.value.length) return 0
  const pcts = goals.value.map(g => g.status === 'achieved' ? 100 : (g.progress ?? 0))
  return Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)
})

onMounted(loadGoals)

async function loadGoals() {
  loading.value = true
  try { goals.value = await apiFetch(`/api/goals?month=${month.value}`) }
  catch { goals.value = [] }
  finally { loading.value = false }
}

function toggleExpand(id) {
  const s = new Set(expanded.value)
  s.has(id) ? s.delete(id) : s.add(id)
  expanded.value = s
}

async function updateStatus(goal, status) {
  try { patchGoal(await apiFetch(`/api/goals/${goal.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })) }
  catch (e) { alert('Failed: ' + e.message) }
}

const _progressTimers = {}
function onProgressInput(goal, value) {
  patchGoalLocal(goal.id, { progress: Number(value) })
  clearTimeout(_progressTimers[goal.id])
  _progressTimers[goal.id] = setTimeout(async () => {
    try { await apiFetch(`/api/goals/${goal.id}`, { method: 'PATCH', body: JSON.stringify({ progress: Number(value) }) }) }
    catch {}
  }, 400)
}

async function updateTargetDate(goal, date) {
  try { patchGoal(await apiFetch(`/api/goals/${goal.id}`, { method: 'PATCH', body: JSON.stringify({ targetDate: date || null }) })) }
  catch (e) { alert('Failed: ' + e.message) }
}

async function generateSteps(goal) {
  const s = new Set(generatingSteps.value); s.add(goal.id); generatingSteps.value = s
  const e = new Set(expanded.value); e.add(goal.id); expanded.value = e
  try { patchGoal(await apiFetch(`/api/goals/${goal.id}/steps`, { method: 'POST' })) }
  catch (err) { alert('Failed: ' + err.message) }
  finally {
    const s2 = new Set(generatingSteps.value); s2.delete(goal.id); generatingSteps.value = s2
  }
}

async function toggleStep(goal, stepId) {
  const steps = goal.steps.map(s => s.id === stepId ? { ...s, completed: !s.completed } : s)
  patchGoalLocal(goal.id, { steps })
  try { patchGoal(await apiFetch(`/api/goals/${goal.id}`, { method: 'PATCH', body: JSON.stringify({ steps }) })) }
  catch (e) { patchGoalLocal(goal.id, { steps: goal.steps }); alert('Failed: ' + e.message) }
}

async function deleteGoal(goal) {
  if (!confirm(`Remove "${goal.title}"? This cannot be undone.`)) return
  try { await apiFetch(`/api/goals/${goal.id}`, { method: 'DELETE' }); goals.value = goals.value.filter(g => g.id !== goal.id) }
  catch (e) { alert('Failed: ' + e.message) }
}

function patchGoal(updated) {
  const idx = goals.value.findIndex(g => g.id === updated.id)
  if (idx !== -1) goals.value[idx] = updated
}
function patchGoalLocal(id, fields) {
  const idx = goals.value.findIndex(g => g.id === id)
  if (idx !== -1) goals.value[idx] = { ...goals.value[idx], ...fields }
}

function formatTargetDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function completedSteps(goal) {
  return (goal.steps || []).filter(s => s.completed).length
}

function progressColor(pct) {
  if (pct >= 75) return 'linear-gradient(90deg,#059669,#10b981)'
  if (pct >= 40) return 'linear-gradient(90deg,#d97706,#f59e0b)'
  return 'linear-gradient(90deg,#0d5f6b,#0ea5e9)'
}
</script>

<template>
  <div class="px-6 py-8 max-w-3xl mx-auto space-y-8">

    <!-- ── Hero header ──────────────────────────────────────────────── -->
    <div class="relative overflow-hidden rounded-3xl animate-fade-up"
         style="background:linear-gradient(135deg,#065f46 0%,#059669 50%,#10b981 100%)">
      <div class="absolute -top-10 -right-10 h-52 w-52 rounded-full opacity-15" style="background:rgba(255,255,255,0.4)"></div>
      <div class="absolute bottom-0 left-20 h-28 w-28 rounded-full opacity-10" style="background:rgba(255,255,255,0.6)"></div>

      <div class="relative px-8 py-9">
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-start gap-5">
            <div class="h-14 w-14 rounded-2xl shrink-0 flex items-center justify-center shadow-lg animate-float"
                 style="background:rgba(255,255,255,0.2);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.3)">
              <Target class="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 class="text-2xl font-bold text-white">My Goals</h1>
              <p class="text-emerald-100 text-sm mt-1">{{ monthLabel }} · Track your progress</p>
            </div>
          </div>
          <!-- Add goal button (always visible) -->
          <button
            @click="openAddForm"
            class="shrink-0 flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold transition-all"
            style="background:rgba(255,255,255,0.18);color:white;border:1px solid rgba(255,255,255,0.35);backdrop-filter:blur(8px)"
            onmouseover="this.style.background='rgba(255,255,255,0.28)'"
            onmouseout="this.style.background='rgba(255,255,255,0.18)'"
          >
            <Plus class="h-4 w-4" />
            Add goal
          </button>
        </div>

        <!-- Progress overview -->
        <div v-if="goals.length" class="mt-6 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-sm font-semibold text-emerald-100">Overall progress</span>
            <span class="text-sm font-bold text-white">{{ overallProgress }}%</span>
          </div>
          <div class="h-2.5 rounded-full overflow-hidden" style="background:rgba(255,255,255,0.2)">
            <div class="h-full rounded-full transition-all duration-700"
                 style="background:rgba(255,255,255,0.9)"
                 :style="{ width: overallProgress + '%' }"></div>
          </div>
          <div class="flex items-center gap-4 text-xs text-emerald-100 mt-1">
            <span>{{ activeGoals.length }} in progress</span>
            <span>{{ achievedGoals.length }} achieved</span>
            <span v-if="shelvedGoals.length">{{ shelvedGoals.length }} shelved</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Loading ──────────────────────────────────────────────────── -->
    <div v-if="loading" class="flex flex-col items-center gap-3 py-16">
      <div class="h-10 w-10 rounded-2xl flex items-center justify-center animate-pulse"
           style="background:linear-gradient(135deg,#059669,#10b981)">
        <Target class="h-5 w-5 text-white" />
      </div>
      <p class="text-sm text-slate-400">Loading your goals…</p>
    </div>

    <!-- ── Empty state ───────────────────────────────────────────────── -->
    <div v-else-if="!goals.length && !showAddForm" class="space-y-4 animate-fade-up">
      <div class="card px-8 py-10 text-center">
        <div class="h-16 w-16 rounded-2xl flex items-center justify-center mx-auto mb-4 animate-float"
             style="background:linear-gradient(135deg,#d1fae5,#a7f3d0)">
          <Target class="h-8 w-8 text-emerald-500" />
        </div>
        <p class="text-lg font-bold text-slate-700">No goals yet for {{ monthLabel }}</p>
        <p class="text-sm text-slate-400 mt-1 mb-7">Choose how you'd like to get started:</p>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <!-- Path 1: Add manually -->
          <button
            @click="openAddForm"
            class="group flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-6 text-center transition-all duration-200 hover:border-emerald-400 hover:bg-emerald-50/60"
            style="border-color:#d1d5db"
          >
            <div class="h-11 w-11 rounded-xl flex items-center justify-center transition-all group-hover:scale-110"
                 style="background:linear-gradient(135deg,#d1fae5,#a7f3d0)">
              <PenLine class="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p class="text-sm font-bold text-slate-700 group-hover:text-emerald-700 transition-colors">Add a goal yourself</p>
              <p class="text-xs text-slate-400 mt-0.5 leading-relaxed">Quick and direct — type your goal and start tracking right away.</p>
            </div>
          </button>

          <!-- Path 2: Go to Planner -->
          <button
            @click="emit('navigate', 'planner')"
            class="group flex flex-col items-center gap-3 rounded-2xl border-2 p-6 text-center transition-all duration-200"
            style="border-color:#0d5f6b;background:linear-gradient(135deg,#f0fdfa,#e0f5f7)"
          >
            <div class="h-11 w-11 rounded-xl flex items-center justify-center transition-all group-hover:scale-110"
                 style="background:linear-gradient(135deg,#0d5f6b,#0e8095)">
              <CalendarDays class="h-5 w-5 text-white" />
            </div>
            <div>
              <p class="text-sm font-bold transition-colors" style="color:#0d5f6b">Build with AI in Planner</p>
              <p class="text-xs text-slate-500 mt-0.5 leading-relaxed">Chat with your AI coach to create a focused plan for the month.</p>
            </div>
          </button>
        </div>
      </div>
    </div>

    <!-- ── Add goal inline form ─────────────────────────────────────────── -->
    <div v-if="showAddForm" class="card p-6 animate-scale-in">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2.5">
          <div class="h-8 w-8 rounded-xl flex items-center justify-center"
               style="background:linear-gradient(135deg,#059669,#10b981)">
            <Plus class="h-4 w-4 text-white" />
          </div>
          <h3 class="text-sm font-bold text-slate-800">New goal</h3>
        </div>
        <button @click="cancelAdd" class="h-8 w-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition">
          <X class="h-4 w-4" />
        </button>
      </div>

      <div class="space-y-3">
        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
            Goal title <span class="text-rose-400">*</span>
          </label>
          <input
            v-model="newGoal.title"
            type="text"
            placeholder="e.g. Complete the leadership programme"
            class="input"
            @keydown.enter="saveNewGoal"
            autofocus
          />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Description <span class="text-slate-300 font-normal normal-case">(optional)</span></label>
          <input
            v-model="newGoal.description"
            type="text"
            placeholder="Add more detail if you like"
            class="input"
            @keydown.enter="saveNewGoal"
          />
        </div>
      </div>

      <p v-if="addError" class="mt-2 text-sm text-rose-600 bg-rose-50 rounded-xl px-3 py-2">{{ addError }}</p>

      <div class="flex gap-2.5 mt-5">
        <button @click="cancelAdd" class="btn btn-ghost">Cancel</button>
        <button
          @click="saveNewGoal"
          :disabled="!newGoal.title.trim() || addingSaving"
          class="btn btn-primary flex-1 justify-center"
          style="background:linear-gradient(135deg,#059669,#10b981);box-shadow:0 2px 8px rgba(5,150,105,0.3)"
        >
          <span v-if="addingSaving">Saving…</span>
          <template v-else>
            <Plus class="h-4 w-4" />
            Create goal
          </template>
        </button>
      </div>
    </div>

    <!-- ── Goals list ─────────────────────────────────────────────────── -->
    <div v-if="goals.length" class="space-y-8">

      <!-- Active goals -->
      <section v-if="activeGoals.length" class="space-y-4 animate-fade-up stagger">
        <div class="flex items-center gap-2">
          <span class="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <h2 class="text-xs font-bold uppercase tracking-wider text-slate-400">In Progress · {{ activeGoals.length }}</h2>
        </div>

        <div v-for="goal in activeGoals" :key="goal.id"
             class="card overflow-hidden group">
          <!-- Top accent bar (progress-colored) -->
          <div class="absolute top-0 left-0 right-0 h-1 transition-all duration-700"
               :style="{ background: progressColor(goal.progress ?? 0) }"></div>

          <div class="p-6">
            <!-- Title row -->
            <div class="flex items-start justify-between gap-3">
              <div class="flex-1 min-w-0">
                <h3 class="font-bold text-slate-900 text-base leading-snug">{{ goal.title }}</h3>
                <p v-if="goal.description" class="text-sm text-slate-500 mt-1 leading-relaxed">{{ goal.description }}</p>
              </div>
              <!-- Date badge -->
              <div v-if="goal.targetDate"
                   class="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
                   style="background:#f0fdf4;color:#065f46;border:1px solid rgba(5,150,105,0.2)">
                <Calendar class="h-3 w-3" />
                {{ formatTargetDate(goal.targetDate) }}
              </div>
            </div>

            <!-- Success criteria -->
            <p v-if="goal.successCriteria" class="mt-3 text-xs text-slate-400 flex items-start gap-2">
              <CheckCircle2 class="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-300" />
              {{ goal.successCriteria }}
            </p>

            <!-- Progress bar + label -->
            <div class="mt-5 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold text-slate-500">Progress</span>
                <span class="text-sm font-bold"
                      :style="{ color: (goal.progress ?? 0) >= 75 ? '#059669' : (goal.progress ?? 0) >= 40 ? '#d97706' : '#0d5f6b' }">
                  {{ goal.progress ?? 0 }}%
                </span>
              </div>
              <!-- Visual bar -->
              <div class="progress-track">
                <div class="progress-fill" :style="{ width: (goal.progress ?? 0) + '%', background: progressColor(goal.progress ?? 0) }"></div>
              </div>
              <!-- Slider -->
              <input
                type="range" min="0" max="100" step="5"
                :value="goal.progress ?? 0"
                @input="onProgressInput(goal, $event.target.value)"
                class="w-full h-1.5 rounded-full appearance-none cursor-pointer mt-1"
                style="accent-color:#059669;background:transparent"
              />
            </div>

            <!-- Due date + steps row -->
            <div class="mt-4 flex items-center gap-4 flex-wrap">
              <div class="flex items-center gap-2">
                <label class="text-xs font-medium text-slate-400">Due</label>
                <input
                  type="date"
                  :value="goal.targetDate || ''"
                  @change="updateTargetDate(goal, $event.target.value)"
                  class="text-xs px-2.5 py-1.5 rounded-xl cursor-pointer transition-all"
                  style="border:1.5px solid #e5e7eb;color:#374151;background:white;outline:none"
                  @focus="$event.target.style.borderColor='#059669'"
                  @blur="$event.target.style.borderColor='#e5e7eb'"
                />
              </div>

              <button @click="toggleExpand(goal.id)"
                      class="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-emerald-600 transition ml-auto">
                <ChevronDown class="h-3.5 w-3.5 transition-transform duration-200"
                              :class="expanded.has(goal.id) ? 'rotate-180' : ''" />
                <template v-if="goal.steps?.length">
                  Steps ({{ completedSteps(goal) }}/{{ goal.steps.length }})
                </template>
                <template v-else>Steps</template>
              </button>
            </div>

            <!-- Steps panel -->
            <div v-if="expanded.has(goal.id)" class="mt-4 pt-4 border-t border-slate-100 space-y-4">
              <!-- Step list -->
              <div v-if="goal.steps?.length" class="space-y-2">
                <button
                  v-for="step in goal.steps"
                  :key="step.id"
                  @click="toggleStep(goal, step.id)"
                  class="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all duration-150 group/step"
                  :style="step.completed
                    ? 'background:#f0fdf4;border:1px solid rgba(5,150,105,0.15)'
                    : 'background:#f9fafb;border:1px solid rgba(0,0,0,0.05)'">
                  <div class="h-5 w-5 rounded-md flex items-center justify-center shrink-0 transition-all duration-200 border-2"
                       :style="step.completed
                         ? 'background:linear-gradient(135deg,#059669,#10b981);border-color:transparent'
                         : 'background:white;border-color:#d1d5db'">
                    <svg v-if="step.completed" class="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <span class="text-sm transition-colors"
                        :class="step.completed ? 'text-slate-400 line-through' : 'text-slate-700'">
                    {{ step.title }}
                  </span>
                </button>
              </div>

              <!-- Generate / regenerate steps -->
              <div class="flex items-center gap-3">
                <button
                  @click="generateSteps(goal)"
                  :disabled="generatingSteps.has(goal.id)"
                  class="flex items-center gap-2 text-xs font-semibold transition-all disabled:opacity-50"
                  :class="goal.steps?.length
                    ? 'text-slate-400 hover:text-emerald-600'
                    : 'btn btn-primary text-xs py-2 px-4'"
                  :style="!goal.steps?.length ? 'background:linear-gradient(135deg,#059669,#10b981);box-shadow:0 2px 8px rgba(5,150,105,0.3)' : ''"
                >
                  <span v-if="generatingSteps.has(goal.id)" class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current"></span>
                  <Sparkles v-else-if="!goal.steps?.length" class="h-3.5 w-3.5" />
                  <RefreshCw v-else class="h-3.5 w-3.5" />
                  {{ generatingSteps.has(goal.id) ? 'Generating…' : goal.steps?.length ? 'Regenerate steps' : 'Generate AI steps' }}
                </button>
              </div>
            </div>
          </div>

          <!-- Action bar -->
          <div class="flex items-center justify-between px-6 py-3"
               style="border-top:1px solid rgba(0,0,0,0.05);background:#fafafa">
            <button @click="updateStatus(goal, 'achieved')"
                    class="flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-xl transition-all"
                    style="color:#059669;background:#f0fdf4;border:1px solid rgba(5,150,105,0.2)"
                    onmouseover="this.style.background='#dcfce7'"
                    onmouseout="this.style.background='#f0fdf4'">
              <CheckCircle2 class="h-3.5 w-3.5" />
              Mark achieved
            </button>
            <div class="flex items-center gap-1">
              <button @click="updateStatus(goal, 'shelved')"
                      class="h-8 w-8 rounded-xl flex items-center justify-center transition-all text-slate-300 hover:text-amber-500 hover:bg-amber-50"
                      title="Shelf this goal">
                <Archive class="h-4 w-4" />
              </button>
              <button @click="deleteGoal(goal)"
                      class="h-8 w-8 rounded-xl flex items-center justify-center transition-all text-slate-300 hover:text-rose-500 hover:bg-rose-50"
                      title="Delete goal">
                <Trash2 class="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Achieved goals -->
      <section v-if="achievedGoals.length" class="space-y-3 animate-fade-up">
        <div class="flex items-center gap-2">
          <span class="h-2 w-2 rounded-full bg-emerald-400"></span>
          <h2 class="text-xs font-bold uppercase tracking-wider text-slate-400">Achieved · {{ achievedGoals.length }}</h2>
        </div>

        <div v-for="goal in achievedGoals" :key="goal.id"
             class="flex items-center gap-4 px-5 py-4 rounded-2xl group transition-all"
             style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1px solid rgba(5,150,105,0.15)">
          <div class="h-8 w-8 rounded-xl flex items-center justify-center shrink-0"
               style="background:linear-gradient(135deg,#059669,#10b981)">
            <CheckCircle2 class="h-4 w-4 text-white" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-slate-600 line-through decoration-emerald-400/50">{{ goal.title }}</p>
          </div>
          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button @click="updateStatus(goal, 'active')"
                    class="text-xs font-semibold text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-white/80 transition">
              Undo
            </button>
            <button @click="deleteGoal(goal)"
                    class="h-7 w-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-rose-500 hover:bg-white/80 transition">
              <Trash2 class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </section>

      <!-- Shelved goals -->
      <section v-if="shelvedGoals.length" class="space-y-3 animate-fade-up">
        <div class="flex items-center gap-2">
          <span class="h-2 w-2 rounded-full bg-slate-300"></span>
          <h2 class="text-xs font-bold uppercase tracking-wider text-slate-400">Shelved · {{ shelvedGoals.length }}</h2>
        </div>
        <p class="text-xs text-slate-400">Archived at month end. Reactivate anytime to pick them back up.</p>

        <div v-for="goal in shelvedGoals" :key="goal.id"
             class="flex items-center gap-4 px-5 py-4 rounded-2xl group transition-all"
             style="background:#f9fafb;border:1px solid rgba(0,0,0,0.06)">
          <div class="h-8 w-8 rounded-xl flex items-center justify-center shrink-0"
               style="background:#f1f5f9">
            <Archive class="h-4 w-4 text-slate-400" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-slate-400">{{ goal.title }}</p>
            <p v-if="goal.description" class="text-xs text-slate-400 mt-0.5 truncate">{{ goal.description }}</p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button @click="updateStatus(goal, 'active')"
                    class="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl transition-all"
                    style="color:#0d5f6b;background:#e0f5f7;border:1px solid rgba(13,95,107,0.2)">
              <Play class="h-3 w-3" />
              Reactivate
            </button>
            <button @click="deleteGoal(goal)"
                    class="h-7 w-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-rose-500 transition">
              <Trash2 class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </section>

    </div>
  </div>
</template>

<style scoped>
.card { position: relative; }
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px; height: 16px;
  border-radius: 50%;
  background: linear-gradient(135deg, #059669, #10b981);
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(5,150,105,0.4);
  transition: transform .15s ease;
}
input[type="range"]::-webkit-slider-thumb:hover { transform: scale(1.2); }
</style>
