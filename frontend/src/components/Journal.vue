<script setup>
import { ref, computed, onMounted } from 'vue'
import { useSpeech } from '../composables/useSpeech.js'
import { useApi } from '../composables/useApi.js'
import MicButton from './MicButton.vue'

const { apiFetch, apiFetchPublic } = useApi()

// --- Speech ---
const { isSupported: speechSupported, isListening, toggleListening } = useSpeech()

// --- Form state ---
const entryText = ref('')
const entryDate = ref(today())
const entryType = ref('daily')
const loading = ref(false)
const errorMsg = ref('')

// --- Entries ---
const entries = ref([])
const expandedWins = ref({}) // entryId -> winId or null

function today() {
  return new Date().toISOString().slice(0, 10)
}


async function loadEntries() {
  try {
    entries.value = await apiFetch('/api/entries')
  } catch {
    entries.value = []
  }
}

onMounted(loadEntries)

// --- Mic dictation ---
function toggleMic() {
  toggleListening((transcript) => {
    entryText.value = transcript
  })
}

// --- Save & Analyze ---
async function saveAndAnalyze() {
  if (!entryText.value.trim()) {
    errorMsg.value = 'Please write something before saving.'
    return
  }
  errorMsg.value = ''
  loading.value = true

  let newEntry
  try {
    // Phase 1: create the entry in Supabase (analysis = null), show immediately
    newEntry = await apiFetch('/api/entries', {
      method: 'POST',
      body: JSON.stringify({
        date: entryDate.value,
        type: entryType.value,
        text: entryText.value.trim(),
      }),
    })
    entries.value.unshift(newEntry)

    // Reset form
    entryText.value = ''
    entryDate.value = today()
    entryType.value = 'daily'
  } catch (e) {
    errorMsg.value = e?.message ?? String(e)
    loading.value = false
    return
  }

  try {
    // Phase 2: run AI analysis (existing endpoint)
    const analysis = await apiFetchPublic('/api/analyze-journal', {
      method: 'POST',
      body: JSON.stringify({ text: newEntry.text, type: newEntry.type }),
    })

    // Phase 3: persist analysis to Supabase
    const updated = await apiFetch(`/api/entries/${newEntry.id}/analysis`, {
      method: 'PATCH',
      body: JSON.stringify({ analysis }),
    })
    const idx = entries.value.findIndex(e => e.id === newEntry.id)
    if (idx !== -1) entries.value[idx] = updated
  } catch (e) {
    errorMsg.value = e?.message ?? String(e)
    // Persist failure flag
    try {
      const updated = await apiFetch(`/api/entries/${newEntry.id}/analysis`, {
        method: 'PATCH',
        body: JSON.stringify({ analysisFailed: true }),
      })
      const idx = entries.value.findIndex(e => e.id === newEntry.id)
      if (idx !== -1) entries.value[idx] = updated
    } catch { /* best effort */ }
  } finally {
    loading.value = false
  }
}

// --- Delete entry ---
async function deleteEntry(id) {
  if (!confirm('Delete this journal entry?')) return
  try {
    await apiFetch(`/api/entries/${id}`, { method: 'DELETE' })
    entries.value = entries.value.filter(e => e.id !== id)
  } catch (e) {
    alert('Failed to delete: ' + e.message)
  }
}

// --- Expand/collapse win details ---
function toggleWin(entryId, winId) {
  const current = expandedWins.value[entryId]
  expandedWins.value[entryId] = current === winId ? null : winId
}

// --- Sorted entries ---
const sortedEntries = computed(() =>
  [...entries.value].sort((a, b) => b.createdAt - a.createdAt)
)

// --- Helpers ---
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

const typePillClass = {
  daily:  'border-teal-200 bg-teal-50 text-teal-800',
  weekly: 'border-amber-200 bg-amber-50 text-amber-800',
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6 space-y-6">

    <!-- New entry form -->
    <div class="relative overflow-hidden rounded-3xl border border-slate-200/60 bg-white shadow-lg shadow-slate-200/30">
      <!-- Gradient background -->
      <div class="absolute inset-0 bg-gradient-to-br from-white via-slate-50/30 to-teal-50/10"></div>
      
      <div class="relative border-b border-slate-100/60 px-6 py-5">
        <div class="flex items-center gap-3">
          <div class="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[#0d5f6b] to-[#0a4a54] shadow-lg shadow-[#0d5f6b]/20">
            <svg class="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/>
            </svg>
          </div>
          <div>
            <h2 class="text-lg font-bold text-slate-800">New journal entry</h2>
            <p class="text-sm text-slate-500">Jot down what happened — I'll pull out the wins automatically.</p>
          </div>
        </div>
      </div>

      <div class="relative space-y-5 px-6 py-6">
        <!-- Date + type row -->
        <div class="flex flex-wrap items-end gap-4">
          <div>
            <label class="text-xs font-bold uppercase tracking-wider text-slate-400">Date</label>
            <input
              v-model="entryDate"
              type="date"
              class="mt-2 block rounded-2xl border border-slate-200/60 bg-white/80 px-4 py-2.5 text-sm shadow-sm
                     focus:border-[#0d5f6b]/40 focus:ring-4 focus:ring-[#0d5f6b]/10 focus:outline-none transition"
            />
          </div>

          <div>
            <label class="text-xs font-bold uppercase tracking-wider text-slate-400">Type</label>
            <div class="mt-2 flex rounded-2xl border border-slate-200/60 overflow-hidden shadow-sm">
              <button
                @click="entryType = 'daily'"
                class="px-5 py-2.5 text-sm font-semibold transition-all duration-200"
                :class="entryType === 'daily'
                  ? 'bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'"
              >
                Daily
              </button>
              <button
                @click="entryType = 'weekly'"
                class="px-5 py-2.5 text-sm font-semibold transition-all duration-200"
                :class="entryType === 'weekly'
                  ? 'bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'"
              >
                Weekly recap
              </button>
            </div>
          </div>
        </div>

        <!-- Text area + mic -->
        <div>
          <div class="flex items-center justify-between mb-3">
            <label class="text-sm font-bold text-slate-700">
              {{ entryType === 'weekly' ? 'How did the week go?' : 'What happened today?' }}
            </label>
            <MicButton
              :listening="isListening"
              :supported="speechSupported"
              @click="toggleMic"
            />
          </div>
          <textarea
            v-model="entryText"
            rows="6"
            class="w-full rounded-2xl border border-slate-200/60 bg-white/80 px-4 py-3 text-sm shadow-sm
                   focus:border-[#0d5f6b]/40 focus:ring-4 focus:ring-[#0d5f6b]/10 focus:outline-none transition"
            :class="isListening ? 'border-[#0d5f6b]/40 ring-4 ring-[#0d5f6b]/10' : ''"
            :placeholder="entryType === 'weekly'
              ? 'What went well this week? Any wins worth celebrating? Who stood out?'
              : 'What happened today? Any small wins, breakthroughs, or moments worth noting?'"
          />
          <p v-if="isListening" class="mt-2 flex items-center gap-2 text-sm text-[#0d5f6b] font-semibold">
            <span class="h-2.5 w-2.5 rounded-full bg-[#0d5f6b] animate-pulse"></span>
            Listening — speak now, click the mic again to stop
          </p>
        </div>

        <div v-if="errorMsg" class="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-sm text-rose-800">
          <span class="font-bold">Error:</span> {{ errorMsg }}
        </div>

        <button
          @click="saveAndAnalyze"
          :disabled="loading"
          class="inline-flex w-full items-center justify-center gap-2.5 rounded-2xl
                 bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] hover:from-[#0b5060] hover:to-[#0a4a54] px-5 py-3.5 text-sm font-bold text-white
                 shadow-lg shadow-[#0d5f6b]/25 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
        >
          <span v-if="loading" class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
          {{ loading ? 'Saving & finding wins…' : 'Save & analyze' }}
        </button>
      </div>
    </div>

    <!-- Entry history -->
    <div v-if="sortedEntries.length" class="space-y-5">
      <h2 class="text-base font-bold text-slate-800 px-1 flex items-center gap-2">
        <span class="h-1.5 w-1.5 rounded-full bg-[#0d5f6b]"></span>
        Journal history
      </h2>

      <div
        v-for="entry in sortedEntries"
        :key="entry.id"
        class="group relative overflow-hidden rounded-3xl border border-slate-200/60 bg-white shadow-sm hover:shadow-lg hover:shadow-slate-200/40 transition-all duration-300"
      >
        <!-- Gradient hover effect -->
        <div class="absolute inset-0 bg-gradient-to-br from-teal-50/0 via-white to-emerald-50/0 group-hover:from-teal-50/20 group-hover:to-emerald-50/10 transition-all duration-300"></div>
        
        <!-- Entry header -->
        <div class="relative flex items-start justify-between gap-3 border-b border-slate-100/60 px-6 py-4">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-bold text-slate-900">{{ formatDate(entry.date) }}</span>
            <span
              class="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
              :class="typePillClass[entry.type] || 'border-slate-200 bg-slate-50 text-slate-600'"
            >
              {{ entry.type === 'weekly' ? 'Weekly recap' : 'Daily' }}
            </span>
          </div>
          <button
            @click="deleteEntry(entry.id)"
            class="shrink-0 rounded-xl p-2 text-slate-300 hover:bg-rose-50 hover:text-rose-500 transition"
            title="Delete entry"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
            </svg>
          </button>
        </div>

        <div class="relative px-6 py-5 space-y-5">
          <!-- Entry text preview -->
          <p class="text-sm text-slate-600 line-clamp-3 leading-relaxed">{{ entry.text }}</p>

          <!-- Analysis loading indicator -->
          <div v-if="!entry.analysis && !entry.analysisFailed" class="flex items-center gap-3 text-sm text-slate-500 bg-slate-50/50 rounded-xl p-3">
            <span class="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-[#0d5f6b]"></span>
            Analyzing for wins…
          </div>

          <!-- Analysis failed -->
          <div v-else-if="entry.analysisFailed" class="text-sm text-rose-600 bg-rose-50/50 rounded-xl p-3">
            Analysis failed. The backend may be unavailable.
          </div>

          <!-- Analysis results -->
          <div v-else-if="entry.analysis" class="space-y-4">
            <div class="relative pl-4 border-l-2 border-teal-200/60">
              <p class="text-sm text-slate-600">
                <span class="font-bold text-slate-800">Summary:</span> {{ entry.analysis.summary }}
              </p>
            </div>

            <div v-if="entry.analysis.wins?.length">
              <p class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
                <span class="h-2 w-2 rounded-full bg-gradient-to-br from-[#0d5f6b] to-teal-400"></span>
                Detected wins
              </p>
              <div class="space-y-3">
                <div
                  v-for="win in entry.analysis.wins"
                  :key="win.id"
                  class="group/win rounded-2xl border border-slate-200/60 overflow-hidden bg-slate-50/30"
                >
                  <button
                    @click="toggleWin(entry.id, win.id)"
                    class="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-white/50 transition duration-200"
                  >
                    <span class="text-sm font-bold text-slate-900">{{ win.title }}</span>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-5 w-5 shrink-0 text-slate-400 transition-transform duration-300"
                      :class="expandedWins[entry.id] === win.id ? 'rotate-180' : ''"
                      viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    >
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>

                  <div
                    v-if="expandedWins[entry.id] === win.id"
                    class="border-t border-slate-100/60 px-5 py-4 space-y-3 bg-white/50"
                  >
                    <p class="text-sm text-slate-700"><span class="font-bold text-slate-900">Story:</span> {{ win.story }}</p>
                    <p class="text-sm text-slate-700"><span class="font-bold text-slate-900">Evidence:</span> {{ win.evidence }}</p>
                    <div>
                      <p class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Celebration ideas</p>
                      <ul class="list-disc pl-5 space-y-2 text-sm text-slate-700">
                        <li v-for="(idea, i) in win.celebrationIdeas" :key="i" class="leading-relaxed">{{ idea }}</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div v-else class="text-sm text-slate-400 italic bg-slate-50/50 rounded-xl p-3">No wins detected in this entry.</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="relative overflow-hidden rounded-3xl border border-dashed border-slate-200/60 bg-gradient-to-br from-slate-50 to-white px-5 py-16 text-center">
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_50%_100%,rgba(13,95,107,0.05),transparent_50%)]"></div>
      <div class="relative">
        <p class="text-base font-bold text-slate-600">No journal entries yet.</p>
        <p class="mt-2 text-sm text-slate-400">Write your first entry above — daily notes or a weekly recap.</p>
      </div>
    </div>

  </div>
</template>
