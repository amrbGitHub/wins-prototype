<script setup>
import { ref, onMounted, computed } from 'vue'
import { useApi } from '../composables/useApi.js'

const { apiFetch } = useApi()

// ── State ─────────────────────────────────────────────────────────────────────
const goals   = ref([])
const loading = ref(true)
const month   = ref(new Date().toISOString().slice(0, 7))

const monthLabel = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
})

const activeGoals   = computed(() => goals.value.filter(g => g.status === 'active'))
const achievedGoals = computed(() => goals.value.filter(g => g.status === 'achieved'))

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

// ── Month navigation ──────────────────────────────────────────────────────────
function shiftMonth(delta) {
  const [y, m] = month.value.split('-').map(Number)
  const d = new Date(y, m - 1 + delta)
  month.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  loadGoals()
}

// ── Goal actions ──────────────────────────────────────────────────────────────
async function updateStatus(goal, status) {
  try {
    const updated = await apiFetch(`/api/goals/${goal.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
    const idx = goals.value.findIndex(g => g.id === goal.id)
    if (idx !== -1) goals.value[idx] = updated
  } catch (e) {
    alert('Failed to update: ' + e.message)
  }
}
</script>

<template>
  <main class="mx-auto max-w-3xl px-4 py-8">

    <!-- Header -->
    <div class="mb-8 flex items-center justify-between gap-4">
      <div>
        <h2 class="text-xl font-bold text-slate-800">My Goals</h2>
        <p class="text-sm text-slate-500 mt-0.5">Track the goals you set in your planner</p>
      </div>

      <!-- Month nav -->
      <div class="flex items-center gap-1">
        <button
          @click="shiftMonth(-1)"
          class="rounded-xl border border-slate-200/70 bg-white p-2 hover:bg-slate-50 transition shadow-sm"
        >
          <svg class="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span class="text-sm font-semibold text-slate-700 min-w-[130px] text-center">{{ monthLabel }}</span>
        <button
          @click="shiftMonth(1)"
          class="rounded-xl border border-slate-200/70 bg-white p-2 hover:bg-slate-50 transition shadow-sm"
        >
          <svg class="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
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

      <!-- Active goals -->
      <div v-if="activeGoals.length">
        <h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">In progress</h3>
        <div class="flex flex-col gap-3">
          <div
            v-for="goal in activeGoals"
            :key="goal.id"
            class="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
          >
            <div class="flex items-start gap-4">
              <!-- Status dot -->
              <div class="mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-[#0d5f6b]/40 bg-white" />

              <div class="flex-1 min-w-0">
                <h4 class="font-semibold text-slate-800">{{ goal.title }}</h4>
                <p v-if="goal.description" class="text-sm text-slate-600 mt-1 leading-relaxed">{{ goal.description }}</p>
                <div v-if="goal.successCriteria" class="mt-2.5 flex items-start gap-1.5">
                  <svg class="h-3.5 w-3.5 mt-0.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75" />
                  </svg>
                  <p class="text-xs text-slate-400 leading-relaxed">{{ goal.successCriteria }}</p>
                </div>
              </div>

              <button
                @click="updateStatus(goal, 'achieved')"
                class="shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition"
              >
                Mark achieved
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Achieved goals -->
      <div v-if="achievedGoals.length">
        <h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Achieved</h3>
        <div class="flex flex-col gap-3">
          <div
            v-for="goal in achievedGoals"
            :key="goal.id"
            class="rounded-2xl border border-emerald-200/50 bg-emerald-50/40 p-5"
          >
            <div class="flex items-start gap-4">
              <!-- Checkmark -->
              <div class="mt-1 h-3 w-3 shrink-0 rounded-full bg-emerald-500 flex items-center justify-center">
                <svg class="h-2 w-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </div>

              <div class="flex-1 min-w-0">
                <h4 class="font-semibold text-slate-500 line-through decoration-emerald-400/60">{{ goal.title }}</h4>
                <p v-if="goal.description" class="text-sm text-slate-400 mt-1">{{ goal.description }}</p>
              </div>

              <button
                @click="updateStatus(goal, 'active')"
                class="shrink-0 text-xs text-slate-400 hover:text-slate-600 transition px-2 py-1"
              >
                Undo
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  </main>
</template>
