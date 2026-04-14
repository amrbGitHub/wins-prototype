<script setup>
import { ref, onMounted, computed } from 'vue'
import { useApi } from '../composables/useApi.js'

const { apiFetch } = useApi()

// ── State ─────────────────────────────────────────────────────────────────────
const goals           = ref([])
const loading         = ref(true)
const generatingSteps = ref(new Set())  // Set of goal IDs currently generating steps
const expanded        = ref(new Set())  // Set of goal IDs with steps panel open
const month           = ref(new Date().toISOString().slice(0, 7))

const monthLabel = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
})

const activeGoals   = computed(() => goals.value.filter(g => g.status === 'active'))
const achievedGoals = computed(() => goals.value.filter(g => g.status === 'achieved'))
const shelvedGoals  = computed(() => goals.value.filter(g => g.status === 'shelved'))

onMounted(loadGoals)

// ── Data ──────────────────────────────────────────────────────────────────────
async function loadGoals() {
  loading.value = true
  try {
    goals.value = await apiFetch(`/api/goals?month=${month.value}`)
  } catch {
    goals.value = []
  } finally {
    loading.value = false
  }
}

// ── Expand / collapse steps panel ─────────────────────────────────────────────
function toggleExpand(id) {
  const s = new Set(expanded.value)
  s.has(id) ? s.delete(id) : s.add(id)
  expanded.value = s
}

// ── Status updates ─────────────────────────────────────────────────────────────
async function updateStatus(goal, status) {
  try {
    const updated = await apiFetch(`/api/goals/${goal.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
    patchGoal(updated)
  } catch (e) {
    alert('Failed to update: ' + e.message)
  }
}

// ── Progress slider ───────────────────────────────────────────────────────────
const _progressTimers = {}

function onProgressInput(goal, value) {
  // Optimistically update local state
  patchGoalLocal(goal.id, { progress: Number(value) })
  // Debounce the API call
  clearTimeout(_progressTimers[goal.id])
  _progressTimers[goal.id] = setTimeout(async () => {
    try {
      await apiFetch(`/api/goals/${goal.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ progress: Number(value) }),
      })
    } catch {} // Non-critical — progress will reconcile on next load
  }, 400)
}

// ── Target date ───────────────────────────────────────────────────────────────
async function updateTargetDate(goal, date) {
  try {
    const updated = await apiFetch(`/api/goals/${goal.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ targetDate: date || null }),
    })
    patchGoal(updated)
  } catch (e) {
    alert('Failed to update date: ' + e.message)
  }
}

// ── Steps ─────────────────────────────────────────────────────────────────────
async function generateSteps(goal) {
  const s = new Set(generatingSteps.value)
  s.add(goal.id)
  generatingSteps.value = s
  // Auto-expand so user sees the steps appear
  const e = new Set(expanded.value)
  e.add(goal.id)
  expanded.value = e
  try {
    const updated = await apiFetch(`/api/goals/${goal.id}/steps`, { method: 'POST' })
    patchGoal(updated)
  } catch (err) {
    alert('Failed to generate steps: ' + err.message)
  } finally {
    const s2 = new Set(generatingSteps.value)
    s2.delete(goal.id)
    generatingSteps.value = s2
  }
}

async function toggleStep(goal, stepId) {
  const steps = goal.steps.map(s =>
    s.id === stepId ? { ...s, completed: !s.completed } : s
  )
  // Optimistic update
  patchGoalLocal(goal.id, { steps })
  try {
    const updated = await apiFetch(`/api/goals/${goal.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ steps }),
    })
    patchGoal(updated)
  } catch (e) {
    // Revert
    patchGoalLocal(goal.id, { steps: goal.steps })
    alert('Failed to update step: ' + e.message)
  }
}

// ── Delete ─────────────────────────────────────────────────────────────────────
async function deleteGoal(goal) {
  if (!confirm(`Remove "${goal.title}"? This cannot be undone.`)) return
  try {
    await apiFetch(`/api/goals/${goal.id}`, { method: 'DELETE' })
    goals.value = goals.value.filter(g => g.id !== goal.id)
  } catch (e) {
    alert('Failed to delete: ' + e.message)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Replace a goal in the list by id (full object from server)
function patchGoal(updated) {
  const idx = goals.value.findIndex(g => g.id === updated.id)
  if (idx !== -1) goals.value[idx] = updated
}

// Merge partial fields into a goal locally (without API)
function patchGoalLocal(id, fields) {
  const idx = goals.value.findIndex(g => g.id === id)
  if (idx !== -1) goals.value[idx] = { ...goals.value[idx], ...fields }
}

function formatTargetDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function completedSteps(goal) {
  return (goal.steps || []).filter(s => s.completed).length
}
</script>

<template>
  <main class="mx-auto max-w-3xl px-4 py-8">

    <!-- Header -->
    <div class="mb-8 flex items-center justify-between gap-4">
      <div>
        <h2 class="text-xl font-bold text-slate-800">My Goals</h2>
        <p class="text-sm text-slate-500 mt-0.5">{{ monthLabel }} · Track your progress</p>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center text-slate-400 py-16 text-sm">Loading goals…</div>

    <!-- Empty -->
    <div v-else-if="!goals.length" class="flex flex-col items-center gap-4 py-16 text-center">
      <div class="h-16 w-16 rounded-2xl bg-slate-100 flex items-center justify-center">
        <svg class="h-8 w-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <div>
        <p class="font-semibold text-slate-600 text-sm">No goals for {{ monthLabel }}</p>
        <p class="text-slate-400 text-xs mt-1">Head to the Planner tab to set your goals for this month.</p>
      </div>
    </div>

    <!-- Goals list -->
    <div v-else class="flex flex-col gap-6">

      <!-- Progress summary -->
      <div class="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm flex items-center gap-4">
        <div class="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
          <div
            class="h-2 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-500"
            :style="{ width: goals.length ? `${(achievedGoals.length / goals.length) * 100}%` : '0%' }"
          />
        </div>
        <span class="text-sm font-semibold text-slate-600 shrink-0">
          {{ achievedGoals.length }} / {{ goals.length }} achieved
        </span>
      </div>

      <!-- ── Active goals ──────────────────────────────────────────────────── -->
      <div v-if="activeGoals.length">
        <h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">In progress</h3>
        <div class="flex flex-col gap-3">
          <div
            v-for="goal in activeGoals"
            :key="goal.id"
            class="rounded-2xl border border-slate-200/60 bg-white shadow-sm hover:shadow-md transition-shadow overflow-hidden"
          >
            <!-- Main content -->
            <div class="p-5">
              <div class="flex items-start gap-4">
                <!-- Status indicator -->
                <div class="mt-1.5 h-3 w-3 shrink-0 rounded-full border-2 border-[#0d5f6b]/40 bg-white" />

                <div class="flex-1 min-w-0">
                  <div class="flex items-start justify-between gap-2 flex-wrap">
                    <h4 class="font-semibold text-slate-800 leading-snug">{{ goal.title }}</h4>
                    <!-- Target date badge -->
                    <span v-if="goal.targetDate" class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500 shrink-0">
                      <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
                      {{ formatTargetDate(goal.targetDate) }}
                    </span>
                  </div>
                  <p v-if="goal.description" class="text-sm text-slate-600 mt-1 leading-relaxed">{{ goal.description }}</p>
                  <div v-if="goal.successCriteria" class="mt-2 flex items-start gap-1.5">
                    <svg class="h-3.5 w-3.5 mt-0.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75" />
                    </svg>
                    <p class="text-xs text-slate-400 leading-relaxed">{{ goal.successCriteria }}</p>
                  </div>
                </div>
              </div>

              <!-- Progress slider -->
              <div class="mt-4 space-y-1.5">
                <div class="flex items-center justify-between text-xs text-slate-500">
                  <span class="font-medium">Progress</span>
                  <span class="font-semibold text-[#0d5f6b]">{{ goal.progress ?? 0 }}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  :value="goal.progress ?? 0"
                  @input="onProgressInput(goal, $event.target.value)"
                  class="w-full h-2 rounded-full appearance-none bg-slate-100 accent-[#0d5f6b] cursor-pointer"
                />
              </div>

              <!-- Target date + Steps row -->
              <div class="mt-4 flex items-center justify-between gap-3 flex-wrap">
                <!-- Target date picker -->
                <div class="flex items-center gap-2">
                  <label class="text-xs font-medium text-slate-500">Due date</label>
                  <input
                    type="date"
                    :value="goal.targetDate || ''"
                    @change="updateTargetDate(goal, $event.target.value)"
                    class="text-xs border border-slate-200/70 rounded-xl px-2.5 py-1.5 text-slate-600 focus:outline-none focus:ring-2 focus:ring-[#0d5f6b]/20 bg-white"
                  />
                </div>

                <!-- Steps toggle -->
                <button
                  @click="toggleExpand(goal.id)"
                  class="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-[#0d5f6b] transition"
                >
                  <svg
                    class="h-3.5 w-3.5 transition-transform duration-200"
                    :class="expanded.has(goal.id) ? 'rotate-180' : ''"
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
                  ><polyline points="6 9 12 15 18 9"/></svg>
                  <template v-if="goal.steps?.length">
                    Steps ({{ completedSteps(goal) }}/{{ goal.steps.length }})
                  </template>
                  <template v-else>
                    Steps
                  </template>
                </button>
              </div>

              <!-- Expanded steps panel -->
              <div v-if="expanded.has(goal.id)" class="mt-3 border-t border-slate-100 pt-3 space-y-3">
                <!-- Existing steps -->
                <div v-if="goal.steps?.length" class="space-y-2">
                  <label
                    v-for="step in goal.steps"
                    :key="step.id"
                    class="flex items-center gap-3 cursor-pointer group"
                    @click.prevent="toggleStep(goal, step.id)"
                  >
                    <div
                      class="h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 transition-all"
                      :class="step.completed
                        ? 'border-emerald-500 bg-emerald-500'
                        : 'border-slate-300 group-hover:border-[#0d5f6b]/50'"
                    >
                      <svg v-if="step.completed" class="h-2.5 w-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                      </svg>
                    </div>
                    <span
                      class="text-sm leading-relaxed transition-colors"
                      :class="step.completed ? 'text-slate-400 line-through' : 'text-slate-700'"
                    >{{ step.title }}</span>
                  </label>
                </div>

                <!-- Generate steps button -->
                <button
                  v-if="!goal.steps?.length"
                  @click="generateSteps(goal)"
                  :disabled="generatingSteps.has(goal.id)"
                  class="flex items-center gap-2 rounded-xl border border-dashed border-[#0d5f6b]/30 bg-[#0d5f6b]/5 px-4 py-2.5 text-xs font-semibold text-[#0d5f6b] hover:bg-[#0d5f6b]/10 transition disabled:opacity-50 w-full justify-center"
                >
                  <svg v-if="generatingSteps.has(goal.id)" class="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  <svg v-else class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                  {{ generatingSteps.has(goal.id) ? 'Generating steps…' : 'Generate AI steps' }}
                </button>

                <!-- Regenerate steps (if steps exist) -->
                <button
                  v-else
                  @click="generateSteps(goal)"
                  :disabled="generatingSteps.has(goal.id)"
                  class="flex items-center gap-1.5 text-xs text-slate-400 hover:text-[#0d5f6b] transition disabled:opacity-50"
                >
                  <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                  Regenerate steps
                </button>
              </div>
            </div>

            <!-- Action bar -->
            <div class="border-t border-slate-100 px-5 py-3 flex items-center justify-between bg-slate-50/50">
              <button
                @click="updateStatus(goal, 'achieved')"
                class="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition"
              >
                <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Mark achieved
              </button>
              <button
                @click="deleteGoal(goal)"
                title="Remove this goal"
                class="rounded-xl border border-transparent p-1.5 text-slate-400 hover:text-rose-500 hover:border-rose-200 hover:bg-rose-50 transition"
              >
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Achieved goals ────────────────────────────────────────────────── -->
      <div v-if="achievedGoals.length">
        <h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Achieved</h3>
        <div class="flex flex-col gap-3">
          <div
            v-for="goal in achievedGoals"
            :key="goal.id"
            class="rounded-2xl border border-emerald-200/50 bg-emerald-50/40 p-4"
          >
            <div class="flex items-start gap-3">
              <div class="mt-1.5 h-3 w-3 shrink-0 rounded-full bg-emerald-500 flex items-center justify-center">
                <svg class="h-2 w-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h4 class="font-semibold text-slate-500 line-through decoration-emerald-400/60">{{ goal.title }}</h4>
                <p v-if="goal.description" class="text-sm text-slate-400 mt-0.5">{{ goal.description }}</p>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <button
                  @click="updateStatus(goal, 'active')"
                  class="text-xs text-slate-400 hover:text-slate-600 transition px-2 py-1 rounded-lg hover:bg-white"
                >Undo</button>
                <button
                  @click="deleteGoal(goal)"
                  class="rounded-xl border border-transparent p-1.5 text-slate-300 hover:text-rose-500 hover:border-rose-200 hover:bg-rose-50 transition"
                >
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Shelved goals ─────────────────────────────────────────────────── -->
      <div v-if="shelvedGoals.length">
        <h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Shelved</h3>
        <p class="text-xs text-slate-400 mb-3">These goals were shelved at month end. Reactivate to continue working on them.</p>
        <div class="flex flex-col gap-3">
          <div
            v-for="goal in shelvedGoals"
            :key="goal.id"
            class="rounded-2xl border border-slate-200/40 bg-slate-50/60 p-4"
          >
            <div class="flex items-start gap-3">
              <div class="mt-1.5 h-3 w-3 shrink-0 rounded-full border-2 border-slate-300 bg-white" />
              <div class="flex-1 min-w-0">
                <h4 class="font-semibold text-slate-400">{{ goal.title }}</h4>
                <p v-if="goal.description" class="text-sm text-slate-400 mt-0.5">{{ goal.description }}</p>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <button
                  @click="updateStatus(goal, 'active')"
                  class="text-xs font-semibold text-[#0d5f6b] hover:text-[#0a4a54] transition px-2 py-1 rounded-lg hover:bg-[#0d5f6b]/5 border border-[#0d5f6b]/20"
                >Reactivate</button>
                <button
                  @click="deleteGoal(goal)"
                  class="rounded-xl border border-transparent p-1.5 text-slate-300 hover:text-rose-500 hover:border-rose-200 hover:bg-rose-50 transition"
                >
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  </main>
</template>
