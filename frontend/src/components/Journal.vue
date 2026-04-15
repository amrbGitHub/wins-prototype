<script setup>
import { ref, computed, onMounted } from 'vue'
import { useSpeech } from '../composables/useSpeech.js'
import { useApi } from '../composables/useApi.js'
import MicButton from './MicButton.vue'
import { BookOpen, Send, Trash2, Star, ChevronDown, Sparkles } from 'lucide-vue-next'

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
  <div class="min-h-screen" style="background:var(--page-bg)">

    <!-- ── Hero Banner ──────────────────────────────────────────────────────────── -->
    <div class="relative overflow-hidden" style="background:linear-gradient(135deg,#7c3aed 0%,#6d28d9 50%,#5b21b6 100%)">
      <!-- Decorative blobs -->
      <div class="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/5 blur-3xl"></div>
      <div class="pointer-events-none absolute -bottom-10 left-1/3 h-48 w-48 rounded-full bg-white/5 blur-2xl"></div>
      <div class="pointer-events-none absolute right-1/4 top-1/2 h-32 w-32 rounded-full bg-violet-300/10 blur-xl"></div>

      <div class="relative mx-auto max-w-4xl px-6 py-10">
        <div class="flex items-center gap-5">
          <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 shadow-lg backdrop-blur-sm ring-1 ring-white/20">
            <BookOpen class="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 class="text-2xl font-extrabold tracking-tight text-white drop-shadow-sm">Journal</h1>
            <p class="mt-0.5 text-sm font-medium text-violet-200">Write daily notes — AI finds the wins automatically.</p>
          </div>
        </div>
      </div>
    </div>

    <div class="mx-auto max-w-4xl space-y-6 px-4 py-8">

      <!-- ── New Entry Form Card ─────────────────────────────────────────────────── -->
      <div class="card animate-fade-up overflow-hidden">
        <!-- Card header -->
        <div class="flex items-center gap-3 border-b border-slate-100 px-6 py-5">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100">
            <Sparkles class="h-4.5 w-4.5 text-violet-600" style="width:18px;height:18px" />
          </div>
          <div>
            <h2 class="text-base font-bold text-slate-800">New entry</h2>
            <p class="text-xs text-slate-400">Jot down what happened and AI will extract the wins.</p>
          </div>
        </div>

        <div class="space-y-5 px-6 py-6">
          <!-- Date + type row -->
          <div class="flex flex-wrap items-end gap-4">
            <div>
              <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-400">Date</label>
              <input
                v-model="entryDate"
                type="date"
                class="input"
                style="width:auto;padding:10px 14px"
              />
            </div>
            <div>
              <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-400">Entry type</label>
              <div class="flex overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-0.5">
                <button
                  @click="entryType = 'daily'"
                  class="rounded-lg px-5 py-2 text-sm font-semibold transition-all duration-200"
                  :class="entryType === 'daily'
                    ? 'bg-gradient-to-r from-violet-600 to-violet-700 text-white shadow-md'
                    : 'text-slate-500 hover:text-slate-700'"
                >Daily</button>
                <button
                  @click="entryType = 'weekly'"
                  class="rounded-lg px-5 py-2 text-sm font-semibold transition-all duration-200"
                  :class="entryType === 'weekly'
                    ? 'bg-gradient-to-r from-violet-600 to-violet-700 text-white shadow-md'
                    : 'text-slate-500 hover:text-slate-700'"
                >Weekly recap</button>
              </div>
            </div>
          </div>

          <!-- Textarea + mic -->
          <div>
            <div class="mb-2 flex items-center justify-between">
              <label class="text-sm font-semibold text-slate-700">
                {{ entryType === 'weekly' ? 'How did the week go?' : 'What happened today?' }}
              </label>
              <MicButton :listening="isListening" :supported="speechSupported" @click="toggleMic" />
            </div>
            <textarea
              v-model="entryText"
              rows="6"
              class="input resize-none"
              :class="isListening ? '!border-violet-500 !ring-4 !ring-violet-500/10' : ''"
              :placeholder="entryType === 'weekly'
                ? 'What went well this week? Any wins worth celebrating? Who stood out?'
                : 'What happened today? Any small wins, breakthroughs, or moments worth noting?'"
            />
            <p v-if="isListening" class="mt-2 flex items-center gap-2 text-sm font-semibold text-violet-700">
              <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-violet-600"></span>
              Listening — speak now, click mic to stop
            </p>
          </div>

          <!-- Error -->
          <div v-if="errorMsg" class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <span class="font-bold">Error:</span> {{ errorMsg }}
          </div>

          <!-- Submit button -->
          <button
            @click="saveAndAnalyze"
            :disabled="loading"
            class="btn btn-primary w-full justify-center rounded-xl py-3 text-sm disabled:opacity-60"
            style="background:linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%);box-shadow:0 4px 16px rgba(124,58,237,0.3)"
          >
            <span v-if="loading" class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
            <Send v-else class="h-4 w-4" />
            {{ loading ? 'Saving & analyzing…' : 'Save & analyze' }}
          </button>
        </div>
      </div>

      <!-- ── Entry History ──────────────────────────────────────────────────────── -->
      <div v-if="sortedEntries.length" class="space-y-4">
        <h2 class="flex items-center gap-2 px-1 text-sm font-bold uppercase tracking-wider text-slate-500">
          <BookOpen class="h-4 w-4" />
          Journal history
        </h2>

        <div
          v-for="entry in sortedEntries"
          :key="entry.id"
          class="card card-hover animate-fade-up overflow-hidden"
        >
          <!-- Entry header -->
          <div class="flex items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-bold text-slate-800">{{ formatDate(entry.date) }}</span>
              <span
                class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                :class="typePillClass[entry.type] || 'border-slate-200 bg-slate-50 text-slate-600'"
              >{{ entry.type === 'weekly' ? 'Weekly' : 'Daily' }}</span>
            </div>
            <button
              @click="deleteEntry(entry.id)"
              class="shrink-0 rounded-lg p-2 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
              title="Delete entry"
            >
              <Trash2 class="h-4 w-4" />
            </button>
          </div>

          <div class="space-y-5 px-6 py-5">
            <!-- Entry text -->
            <p class="line-clamp-3 text-sm leading-relaxed text-slate-600">{{ entry.text }}</p>

            <!-- Analyzing -->
            <div v-if="!entry.analysis && !entry.analysisFailed" class="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
              <span class="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-violet-600 shrink-0"></span>
              Analyzing for wins…
            </div>

            <!-- Failed -->
            <div v-else-if="entry.analysisFailed" class="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-600">
              Analysis failed. The backend may be unavailable.
            </div>

            <!-- Results -->
            <div v-else-if="entry.analysis" class="space-y-4">
              <!-- Summary -->
              <div class="rounded-xl bg-violet-50/60 px-4 py-3 text-sm text-slate-700 border-l-4 border-violet-300">
                <span class="font-bold text-violet-800">Summary:</span> {{ entry.analysis.summary }}
              </div>

              <!-- Wins -->
              <div v-if="entry.analysis.wins?.length">
                <p class="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                  <Star class="h-3.5 w-3.5 text-violet-500" />
                  Detected wins
                </p>
                <div class="space-y-2">
                  <div
                    v-for="win in entry.analysis.wins"
                    :key="win.id"
                    class="overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/40"
                  >
                    <button
                      @click="toggleWin(entry.id, win.id)"
                      class="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition hover:bg-white/70"
                    >
                      <div class="flex items-center gap-2.5">
                        <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100">
                          <Star class="h-3 w-3 text-violet-600" />
                        </span>
                        <span class="text-sm font-semibold text-slate-800">{{ win.title }}</span>
                      </div>
                      <ChevronDown
                        class="h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200"
                        :class="expandedWins[entry.id] === win.id ? 'rotate-180' : ''"
                      />
                    </button>

                    <div
                      v-if="expandedWins[entry.id] === win.id"
                      class="space-y-3 border-t border-slate-100 bg-white/60 px-5 py-4"
                    >
                      <p class="text-sm text-slate-700"><span class="font-semibold text-slate-900">Story: </span>{{ win.story }}</p>
                      <p class="text-sm text-slate-700"><span class="font-semibold text-slate-900">Evidence: </span>{{ win.evidence }}</p>
                      <div>
                        <p class="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Celebration ideas</p>
                        <ul class="space-y-1.5">
                          <li
                            v-for="(idea, i) in win.celebrationIdeas"
                            :key="i"
                            class="flex items-start gap-2 text-sm text-slate-700"
                          >
                            <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400"></span>
                            {{ idea }}
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else class="rounded-xl bg-slate-50 px-4 py-3 text-sm italic text-slate-400">
                No wins detected in this entry.
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Empty state ────────────────────────────────────────────────────────── -->
      <div
        v-else
        class="card flex flex-col items-center gap-4 py-16 text-center animate-fade-up"
      >
        <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-50">
          <BookOpen class="h-8 w-8 text-violet-300" />
        </div>
        <div>
          <p class="font-bold text-slate-700">No journal entries yet.</p>
          <p class="mt-1 text-sm text-slate-400">Write your first entry above — daily notes or a weekly recap.</p>
        </div>
      </div>

    </div>
  </div>
</template>
