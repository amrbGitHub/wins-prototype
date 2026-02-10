<script setup>
import { computed, reactive, ref } from 'vue'

const form = reactive({
  wentWell: '',
  wasHard: '',
  visibleWin: '',
  recognizeWho: '',
  outcome: 'Engagement',
})

const loadingAnalyze = ref(false)
const loadingDraft = ref(false)
const errorMsg = ref('')

const analysis = ref(null)
const selectedWinId = ref(null)

const draft = ref('')
const channel = ref('Email')
const tone = ref('Warm')

const selectedWin = computed(() => {
  if (!analysis.value) return null
  return analysis.value.wins.find(w => w.id === selectedWinId.value) ?? null
})

const outcomePills = {
  Safety: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  Quality: 'border-sky-200 bg-sky-50 text-sky-800',
  Retention: 'border-violet-200 bg-violet-50 text-violet-800',
  Efficiency: 'border-amber-200 bg-amber-50 text-amber-900',
  Engagement: 'border-rose-200 bg-rose-50 text-rose-800',
}

async function analyzeWeek() {
  errorMsg.value = ''
  analysis.value = null
  selectedWinId.value = null
  draft.value = ''

  loadingAnalyze.value = true
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (!res.ok) throw new Error(await res.text())
    analysis.value = await res.json()
    if (analysis.value?.wins?.length) selectedWinId.value = analysis.value.wins[0].id
  } catch (e) {
    errorMsg.value = e?.message ?? String(e)
  } finally {
    loadingAnalyze.value = false
  }
}

async function generateDraft() {
  errorMsg.value = ''
  draft.value = ''
  if (!selectedWin.value) {
    errorMsg.value = 'Select a win first.'
    return
  }

  loadingDraft.value = true
  try {
    const res = await fetch('/api/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        win: selectedWin.value,
        channel: channel.value,
        tone: tone.value,
        outcome: form.outcome,
        recognizeWho: form.recognizeWho,
      }),
    })
    if (!res.ok) throw new Error(await res.text())
    const data = await res.json()
    draft.value = data.draft
  } catch (e) {
    errorMsg.value = e?.message ?? String(e)
  } finally {
    loadingDraft.value = false
  }
}

async function copyDraft() {
  if (!draft.value) return
  await navigator.clipboard.writeText(draft.value)
  alert('Copied to clipboard')
}

function resetAll() {
  form.wentWell = ''
  form.wasHard = ''
  form.visibleWin = ''
  form.recognizeWho = ''
  form.outcome = 'Engagement'
  analysis.value = null
  selectedWinId.value = null
  draft.value = ''
  errorMsg.value = ''
}
</script>

<template>
  <div
    class="min-h-screen text-slate-900
           bg-[radial-gradient(90%_70%_at_15%_0%,rgba(251,191,36,0.20),transparent_55%),radial-gradient(80%_60%_at_85%_0%,rgba(244,63,94,0.16),transparent_60%),linear-gradient(to_bottom,#fff,#fff)]"
  >
    <!-- Header -->
    <header class="sticky top-0 z-10 border-b border-slate-200/60 bg-white/80 backdrop-blur">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <div class="flex items-center gap-3">
          <div class="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-rose-600 to-amber-400 text-white shadow-sm">
            <span class="text-lg font-bold">W</span>
          </div>
          <div>
            <h1 class="text-lg font-semibold leading-tight">Celebrating Wins</h1>
            <p class="text-sm text-slate-500 -mt-0.5">Make training impact visible—without extra friction</p>
          </div>
        </div>

        <div class="hidden sm:flex items-center gap-2">
          <span class="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">Warm / people-first</span>
          <button
            @click="resetAll"
            class="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Reset
          </button>
        </div>
      </div>
    </header>

    <main class="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-12">
      <!-- Left: Check-in -->
      <section class="lg:col-span-5 space-y-4">
        <div class="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div class="border-b border-slate-100 px-5 py-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h2 class="text-base font-semibold">Weekly check-in</h2>
                <p class="mt-1 text-sm text-slate-500">
                  Talk it out. I’ll pull out the wins and turn them into messages you can send.
                </p>
              </div>
              <span class="hidden sm:inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600">
                Demo
              </span>
            </div>
          </div>

          <div class="space-y-4 px-5 py-5">
            <div>
              <label class="text-sm font-medium text-slate-700">What went well?</label>
              <textarea
                v-model="form.wentWell"
                rows="3"
                class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm
                       focus:border-rose-300 focus:ring-4 focus:ring-rose-100 focus:outline-none"
                placeholder="A moment that felt like progress…"
              />
            </div>

            <div>
              <label class="text-sm font-medium text-slate-700">What was hard?</label>
              <textarea
                v-model="form.wasHard"
                rows="3"
                class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm
                       focus:border-amber-300 focus:ring-4 focus:ring-amber-100 focus:outline-none"
                placeholder="Where did old habits show up again?"
              />
            </div>

            <div>
              <label class="text-sm font-medium text-slate-700">What win should be visible to leadership?</label>
              <textarea
                v-model="form.visibleWin"
                rows="3"
                class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm
                       focus:border-rose-300 focus:ring-4 focus:ring-rose-100 focus:outline-none"
                placeholder="Something leadership would care about if they saw it…"
              />
            </div>

            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label class="text-sm font-medium text-slate-700">Who should be recognized?</label>
                <input
                  v-model="form.recognizeWho"
                  class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm
                         focus:border-rose-300 focus:ring-4 focus:ring-rose-100 focus:outline-none"
                  placeholder="Name(s) or team"
                />
              </div>

              <div>
                <label class="text-sm font-medium text-slate-700">Primary outcome</label>
                <select
                  v-model="form.outcome"
                  class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm
                         focus:border-amber-300 focus:ring-4 focus:ring-amber-100 focus:outline-none"
                >
                  <option>Safety</option>
                  <option>Quality</option>
                  <option>Retention</option>
                  <option>Efficiency</option>
                  <option>Engagement</option>
                </select>
              </div>
            </div>

            <div v-if="errorMsg" class="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              <span class="font-semibold">Error:</span> {{ errorMsg }}
            </div>

            <button
              @click="analyzeWeek"
              :disabled="loadingAnalyze"
              class="inline-flex w-full items-center justify-center gap-2 rounded-2xl
                     bg-gradient-to-r from-rose-600 to-amber-500 px-4 py-3 text-sm font-semibold text-white
                     shadow-sm transition hover:brightness-95 disabled:opacity-60"
            >
              <span v-if="loadingAnalyze" class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
              {{ loadingAnalyze ? 'Finding the wins…' : 'Analyze my week' }}
            </button>

            <div class="rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
              <span class="font-semibold">Coach tip:</span>
              Include one specific moment + who was involved + what changed.
            </div>
          </div>
        </div>
      </section>

      <!-- Right: Results -->
      <section class="lg:col-span-7 space-y-4">
        <div class="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div class="border-b border-slate-100 px-5 py-4">
            <h2 class="text-base font-semibold">Wins & celebration drafts</h2>
            <p class="mt-1 text-sm text-slate-500">Select a win → generate a message → copy and send.</p>
          </div>

          <div class="px-5 py-5">
            <div v-if="!analysis" class="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-12 text-center">
              <p class="text-sm text-slate-600">Run your check-in to see wins here.</p>
              <p class="mt-1 text-xs text-slate-500">This is intentionally calm and lightweight—like a pocket coach.</p>
            </div>

            <div v-else class="space-y-5">
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium"
                  :class="outcomePills[form.outcome] || 'border-slate-200 bg-slate-50 text-slate-700'"
                >
                  Outcome: {{ form.outcome }}
                </span>

                <span class="text-sm text-slate-700">
                  <span class="font-semibold">Summary:</span> {{ analysis.summary }}
                </span>
              </div>

              <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                <!-- Wins list -->
                <div class="space-y-2">
                  <h3 class="text-sm font-semibold text-slate-800">Detected wins</h3>

                  <button
                    v-for="w in analysis.wins"
                    :key="w.id"
                    @click="selectedWinId = w.id; draft=''"
                    class="w-full rounded-3xl border px-4 py-4 text-left transition"
                    :class="selectedWinId === w.id
                      ? 'border-rose-300 bg-rose-50/40'
                      : 'border-slate-200 bg-white hover:border-slate-300'"
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <div class="text-sm font-semibold text-slate-900">{{ w.title }}</div>
                        <div class="mt-1 text-xs text-slate-600 line-clamp-3">{{ w.story }}</div>
                      </div>
                      <span class="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-700">
                        Win
                      </span>
                    </div>
                  </button>
                </div>

                <!-- Selected win + Draft -->
                <div v-if="selectedWin" class="space-y-3">
                  <h3 class="text-sm font-semibold text-slate-800">Selected win</h3>

                  <div class="rounded-3xl border border-slate-200 bg-white px-4 py-4">
                    <p class="text-sm"><span class="font-semibold">Title:</span> {{ selectedWin.title }}</p>

                    <p class="mt-2 text-sm text-slate-700">
                      <span class="font-semibold text-slate-900">Story:</span> {{ selectedWin.story }}
                    </p>

                    <p class="mt-2 text-sm text-slate-700">
                      <span class="font-semibold text-slate-900">Evidence:</span> {{ selectedWin.evidence }}
                    </p>

                    <div class="mt-3">
                      <div class="text-xs font-semibold uppercase tracking-wide text-slate-500">Celebration ideas</div>
                      <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                        <li v-for="(idea, idx) in selectedWin.celebrationIdeas" :key="idx">{{ idea }}</li>
                      </ul>
                    </div>
                  </div>

                  <div class="rounded-3xl border border-slate-200 bg-white px-4 py-4">
                    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
                      <div>
                        <label class="text-xs font-semibold uppercase tracking-wide text-slate-500">Channel</label>
                        <select
                          v-model="channel"
                          class="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm
                                 focus:outline-none focus:ring-4 focus:ring-amber-100"
                        >
                          <option>Email</option>
                          <option>Exec update</option>
                          <option>LinkedIn</option>
                        </select>
                      </div>

                      <div>
                        <label class="text-xs font-semibold uppercase tracking-wide text-slate-500">Tone</label>
                        <select
                          v-model="tone"
                          class="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm
                                 focus:outline-none focus:ring-4 focus:ring-rose-100"
                        >
                          <option>Warm</option>
                          <option>Crisp</option>
                          <option>Executive</option>
                        </select>
                      </div>

                      <button
                        @click="generateDraft"
                        :disabled="loadingDraft"
                        class="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3
                               text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
                      >
                        <span v-if="loadingDraft" class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
                        {{ loadingDraft ? 'Writing…' : 'Generate draft' }}
                      </button>
                    </div>

                    <textarea
                      v-model="draft"
                      rows="10"
                      class="mt-3 w-full rounded-3xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm
                             focus:border-slate-400 focus:ring-4 focus:ring-slate-100 focus:outline-none"
                      placeholder="Draft will appear here…"
                    />

                    <div class="mt-2 flex items-center justify-between">
                      <p class="text-xs text-slate-500">This is a starting point—edit freely.</p>
                      <button
                        @click="copyDraft"
                        :disabled="!draft"
                        class="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900
                               shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                </div>

                <div v-else class="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center">
                  <p class="text-sm text-slate-600">Select a win to generate a draft.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="rounded-3xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <h3 class="text-sm font-semibold text-slate-800">Demo flow (30 seconds)</h3>
          <ol class="mt-2 list-decimal pl-5 text-sm text-slate-700 space-y-1">
            <li>Paste a real weekly moment into the check-in.</li>
            <li>Show the app extracting wins + celebration ideas.</li>
            <li>Generate an exec update draft, then copy.</li>
          </ol>
        </div>
      </section>
    </main>
  </div>
</template>