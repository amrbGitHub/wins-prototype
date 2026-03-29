<script setup>
import { ref, onMounted } from 'vue'
import { useApi } from '../composables/useApi.js'

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
  <main class="mx-auto max-w-3xl px-4 py-8">

    <!-- Header -->
    <div class="mb-8 flex items-center justify-between gap-4">
      <div>
        <h2 class="text-xl font-bold text-slate-800">Reflections</h2>
        <p class="text-sm text-slate-500 mt-0.5">Your weekly progress evaluations</p>
      </div>
      <button
        @click="loadReflections"
        :disabled="loading"
        class="rounded-xl border border-slate-200/70 bg-white p-2 hover:bg-slate-50 transition shadow-sm disabled:opacity-40"
        title="Refresh"
      >
        <svg class="h-4 w-4 text-slate-500" :class="loading ? 'animate-spin' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
        </svg>
      </button>
    </div>

    <!-- Error -->
    <p v-if="error" class="mb-4 text-sm text-rose-500 bg-rose-50 border border-rose-100 rounded-xl px-4 py-2.5">{{ error }}</p>

    <!-- Loading -->
    <div v-if="loading" class="text-center text-slate-400 py-16 text-sm">Loading reflections…</div>

    <!-- Empty -->
    <div v-else-if="!reflections.length" class="flex flex-col items-center gap-4 py-16 text-center">
      <div class="h-16 w-16 rounded-2xl bg-amber-50 flex items-center justify-center">
        <svg class="h-8 w-8 text-amber-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
        </svg>
      </div>
      <div>
        <p class="font-semibold text-slate-600 text-sm">No reflections yet</p>
        <p class="text-slate-400 text-xs mt-1">When you complete a weekly review, your evaluations will appear here.</p>
      </div>
    </div>

    <!-- Reflections list -->
    <div v-else class="flex flex-col gap-4">
      <div
        v-for="r in reflections"
        :key="r.id"
        class="rounded-2xl border border-slate-200/60 bg-white shadow-sm overflow-hidden"
      >
        <!-- Card header (always visible, clickable to expand) -->
        <button
          @click="toggle(r.id)"
          class="w-full flex items-start justify-between gap-4 px-5 py-4 hover:bg-slate-50/60 transition text-left"
        >
          <div class="flex items-center gap-3 min-w-0">
            <div class="h-9 w-9 shrink-0 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm">
              <svg class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div class="min-w-0">
              <p class="text-sm font-bold text-slate-800">{{ monthLabel(r.month) }} Goals Review</p>
              <p class="text-xs text-slate-400 mt-0.5">{{ formatDate(r.createdAt) }}</p>
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <!-- Goal count pill -->
            <span class="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">
              {{ r.goalsSnapshot?.length ?? 0 }} {{ (r.goalsSnapshot?.length ?? 0) === 1 ? 'goal' : 'goals' }}
            </span>
            <!-- Chevron -->
            <svg
              class="h-4 w-4 text-slate-400 transition-transform duration-200"
              :class="expanded.has(r.id) ? 'rotate-180' : ''"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>

        <!-- Expanded content -->
        <div v-if="expanded.has(r.id)" class="border-t border-slate-100 px-5 py-4 flex flex-col gap-4">

          <!-- Goals reviewed -->
          <div>
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Goals reviewed</p>
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="g in r.goalsSnapshot"
                :key="g.id ?? g.title"
                class="rounded-full border border-slate-200/80 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600"
              >{{ g.title }}</span>
            </div>
          </div>

          <!-- Evaluation -->
          <div>
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Evaluation</p>
            <p class="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{{ r.evaluation }}</p>
          </div>

          <!-- Suggestions -->
          <div v-if="r.suggestions?.length">
            <p class="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-2.5">Suggestions</p>
            <ul class="flex flex-col gap-1.5">
              <li
                v-for="(s, i) in r.suggestions"
                :key="i"
                class="flex items-start gap-2 text-sm text-slate-700"
              >
                <span class="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-amber-100 flex items-center justify-center text-xs font-bold text-amber-600">{{ i + 1 }}</span>
                {{ s }}
              </li>
            </ul>
          </div>

        </div>
      </div>
    </div>

  </main>
</template>
