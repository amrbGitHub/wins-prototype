<script setup>
import { ref, computed, onMounted } from 'vue'
import { useSpeech } from '../composables/useSpeech.js'
import MicButton from './MicButton.vue'

const STORAGE_KEY = 'wins-journal'

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

function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    entries.value = raw ? JSON.parse(raw) : []
  } catch {
    entries.value = []
  }
}

function saveEntries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.value))
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

  const newEntry = {
    id: crypto.randomUUID(),
    date: entryDate.value,
    type: entryType.value,
    text: entryText.value.trim(),
    analysis: null,
    createdAt: Date.now(),
  }

  // Optimistically add the entry so it appears immediately
  entries.value.unshift(newEntry)
  saveEntries()

  // Reset form
  entryText.value = ''
  entryDate.value = today()
  entryType.value = 'daily'

  try {
    const res = await fetch('/api/analyze-journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: newEntry.text, type: newEntry.type }),
    })
    if (!res.ok) throw new Error(await res.text())
    const analysis = await res.json()

    // Update the entry in place
    const idx = entries.value.findIndex(e => e.id === newEntry.id)
    if (idx !== -1) {
      entries.value[idx] = { ...entries.value[idx], analysis }
      saveEntries()
    }
  } catch (e) {
    errorMsg.value = e?.message ?? String(e)
    // Mark entry as failed
    const idx = entries.value.findIndex(e => e.id === newEntry.id)
    if (idx !== -1) {
      entries.value[idx] = { ...entries.value[idx], analysisFailed: true }
      saveEntries()
    }
  } finally {
    loading.value = false
  }
}

// --- Delete entry ---
function deleteEntry(id) {
  if (!confirm('Delete this journal entry?')) return
  entries.value = entries.value.filter(e => e.id !== id)
  saveEntries()
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
  daily: 'border-sky-200 bg-sky-50 text-sky-800',
  weekly: 'border-violet-200 bg-violet-50 text-violet-800',
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6 space-y-6">

    <!-- New entry form -->
    <div class="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div class="border-b border-slate-100 px-5 py-4">
        <h2 class="text-base font-semibold">New journal entry</h2>
        <p class="mt-1 text-sm text-slate-500">
          Jot down what happened — I'll pull out the wins automatically.
        </p>
      </div>

      <div class="space-y-4 px-5 py-5">
        <!-- Date + type row -->
        <div class="flex flex-wrap items-center gap-3">
          <div>
            <label class="text-xs font-semibold uppercase tracking-wide text-slate-500">Date</label>
            <input
              v-model="entryDate"
              type="date"
              class="mt-1 block rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm
                     focus:border-rose-300 focus:ring-4 focus:ring-rose-100 focus:outline-none"
            />
          </div>

          <div>
            <label class="text-xs font-semibold uppercase tracking-wide text-slate-500">Type</label>
            <div class="mt-1 flex rounded-2xl border border-slate-200 overflow-hidden">
              <button
                @click="entryType = 'daily'"
                class="px-4 py-2 text-sm font-medium transition"
                :class="entryType === 'daily'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'"
              >
                Daily
              </button>
              <button
                @click="entryType = 'weekly'"
                class="px-4 py-2 text-sm font-medium transition"
                :class="entryType === 'weekly'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'"
              >
                Weekly recap
              </button>
            </div>
          </div>
        </div>

        <!-- Text area + mic -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-sm font-medium text-slate-700">
              {{ entryType === 'weekly' ? 'How did the week go?' : 'What happened today?' }}
            </label>
            <!-- Mic button — always visible; disabled with tooltip when browser doesn't support it -->
            <MicButton
              :listening="isListening"
              :supported="speechSupported"
              @click="toggleMic"
            />
          </div>
          <textarea
            v-model="entryText"
            rows="6"
            class="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm
                   focus:border-rose-300 focus:ring-4 focus:ring-rose-100 focus:outline-none"
            :class="isListening ? 'border-rose-300 ring-4 ring-rose-100' : ''"
            :placeholder="entryType === 'weekly'
              ? 'What went well this week? Any wins worth celebrating? Who stood out?'
              : 'What happened today? Any small wins, breakthroughs, or moments worth noting?'"
          />
          <p v-if="isListening" class="mt-1.5 flex items-center gap-1.5 text-xs text-rose-600 font-medium">
            <span class="h-2 w-2 rounded-full bg-rose-500 animate-pulse"></span>
            Listening — speak now, click the mic again to stop
          </p>
        </div>

        <div v-if="errorMsg" class="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span class="font-semibold">Error:</span> {{ errorMsg }}
        </div>

        <button
          @click="saveAndAnalyze"
          :disabled="loading"
          class="inline-flex w-full items-center justify-center gap-2 rounded-2xl
                 bg-gradient-to-r from-rose-600 to-amber-500 px-4 py-3 text-sm font-semibold text-white
                 shadow-sm transition hover:brightness-95 disabled:opacity-60"
        >
          <span v-if="loading" class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
          {{ loading ? 'Saving & finding wins…' : 'Save & analyze' }}
        </button>
      </div>
    </div>

    <!-- Entry history -->
    <div v-if="sortedEntries.length" class="space-y-4">
      <h2 class="text-base font-semibold text-slate-800 px-1">Journal history</h2>

      <div
        v-for="entry in sortedEntries"
        :key="entry.id"
        class="rounded-3xl border border-slate-200 bg-white shadow-sm"
      >
        <!-- Entry header -->
        <div class="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-semibold text-slate-900">{{ formatDate(entry.date) }}</span>
            <span
              class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium"
              :class="typePillClass[entry.type] || 'border-slate-200 bg-slate-50 text-slate-700'"
            >
              {{ entry.type === 'weekly' ? 'Weekly recap' : 'Daily' }}
            </span>
          </div>
          <button
            @click="deleteEntry(entry.id)"
            class="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
            title="Delete entry"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
            </svg>
          </button>
        </div>

        <div class="px-5 py-4 space-y-4">
          <!-- Entry text preview -->
          <p class="text-sm text-slate-700 line-clamp-3">{{ entry.text }}</p>

          <!-- Analysis loading indicator -->
          <div v-if="!entry.analysis && !entry.analysisFailed" class="flex items-center gap-2 text-sm text-slate-500">
            <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600"></span>
            Analyzing for wins…
          </div>

          <!-- Analysis failed -->
          <div v-else-if="entry.analysisFailed" class="text-sm text-rose-600">
            Analysis failed. The backend may be unavailable.
          </div>

          <!-- Analysis results -->
          <div v-else-if="entry.analysis" class="space-y-3">
            <p class="text-sm text-slate-600">
              <span class="font-semibold text-slate-800">Summary:</span> {{ entry.analysis.summary }}
            </p>

            <div v-if="entry.analysis.wins?.length">
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Detected wins</p>
              <div class="space-y-2">
                <div
                  v-for="win in entry.analysis.wins"
                  :key="win.id"
                  class="rounded-2xl border border-slate-200 overflow-hidden"
                >
                  <button
                    @click="toggleWin(entry.id, win.id)"
                    class="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 transition"
                  >
                    <span class="text-sm font-medium text-slate-900">{{ win.title }}</span>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-4 w-4 shrink-0 text-slate-400 transition-transform"
                      :class="expandedWins[entry.id] === win.id ? 'rotate-180' : ''"
                      viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    >
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>

                  <div
                    v-if="expandedWins[entry.id] === win.id"
                    class="border-t border-slate-100 px-4 py-3 space-y-2 bg-slate-50/50"
                  >
                    <p class="text-sm text-slate-700"><span class="font-semibold text-slate-900">Story:</span> {{ win.story }}</p>
                    <p class="text-sm text-slate-700"><span class="font-semibold text-slate-900">Evidence:</span> {{ win.evidence }}</p>
                    <div>
                      <p class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Celebration ideas</p>
                      <ul class="list-disc pl-5 space-y-1 text-sm text-slate-700">
                        <li v-for="(idea, i) in win.celebrationIdeas" :key="i">{{ idea }}</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div v-else class="text-sm text-slate-500 italic">No wins detected in this entry.</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-14 text-center">
      <p class="text-sm text-slate-600">No journal entries yet.</p>
      <p class="mt-1 text-xs text-slate-400">Write your first entry above — daily notes or a weekly recap.</p>
    </div>

  </div>
</template>
