<script setup>
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { useApi } from '../composables/useApi.js'
import { useSpeech } from '../composables/useSpeech.js'
import { useTTS } from '../composables/useTTS.js'
import MicButton from './MicButton.vue'
import { CalendarDays, Zap, Send, Trash2, Target, ChevronRight, RefreshCw, MessageSquare, Mic } from 'lucide-vue-next'

const props = defineProps({
  firstName: { type: String, default: '' },
})

const emit = defineEmits(['goToGoals', 'startReview'])
const { apiFetch, apiStreamPublic } = useApi()

// Text-mode STT
const { isSupported: speechSupported, isListening, toggleListening, stopListening } = useSpeech()
// TTS for Convo mode
const { isSupported: ttsSupported, isSpeaking, isLoading: ttsLoading, loadProgress, speak, stop: stopSpeaking } = useTTS()

// ── Shared state ──────────────────────────────────────────────────────────────
const month        = ref(new Date().toISOString().slice(0, 7))
const messages     = ref([])
const loading      = ref(false)   // true = typing indicator showing
const deleting     = ref(false)
const goalCount    = ref(0)
const started      = ref(false)
const error        = ref('')
const mode         = ref('text')   // 'text' | 'convo'
const priorContext = ref('')       // evaluation text from last reflection

// Text mode
const input      = ref('')
const messagesEl = ref(null)

// Convo mode — 'idle' | 'listening' | 'processing' | 'speaking'
const convoStatus     = ref('idle')
const convoTranscript = ref('')
let   convoRecognition = null
let   _recId           = 0     // incremented on hard-abort to invalidate stale onend handlers
let   _silenceTimer    = null  // fires rec.stop() after 1500ms of no new final results

const monthLabel = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
})

const convoMode = computed(() => mode.value === 'convo')

// ── Session loading ───────────────────────────────────────────────────────────
async function loadSession() {
  try {
    const [sessionData, goalsData, reflectionData] = await Promise.all([
      apiFetch(`/api/planner/${month.value}`),
      apiFetch(`/api/goals?month=${month.value}`).catch(() => []),
      apiFetch('/api/reflections').catch(() => []),
    ])
    // Use the most recent reflection's evaluation as prior context
    if (Array.isArray(reflectionData) && reflectionData.length) {
      const last = reflectionData[0]
      const parts = []
      if (last.evaluation) parts.push(last.evaluation)
      if (Array.isArray(last.suggestions) && last.suggestions.length) {
        parts.push('Suggestions from last review: ' + last.suggestions.join('; '))
      }
      priorContext.value = parts.join('\n\n')
    }
    if (sessionData?.messages?.length) {
      messages.value  = sessionData.messages
      goalCount.value = goalsData?.length ?? 0
      started.value   = true
      await scrollToBottom()
    } else {
      messages.value  = []
      goalCount.value = 0
      started.value   = false
    }
  } catch {
    messages.value  = []
    goalCount.value = 0
    started.value   = false
  }
}

onMounted(loadSession)
onUnmounted(() => { stopAll() })

// ── Helpers ───────────────────────────────────────────────────────────────────
let _scrollPending = false
async function scrollToBottom() {
  if (_scrollPending) return
  _scrollPending = true
  await nextTick()
  messagesEl.value?.lastElementChild?.scrollIntoView({ behavior: 'smooth' })
  _scrollPending = false
}

// Extract the message string from a partially-streamed JSON blob.
// The model outputs {"message":"...","goals":[...]} — we pull out just the message value.
function extractStreamingMessage(partial) {
  const marker = '"message":"'
  const start = partial.indexOf(marker)
  if (start === -1) return null
  let i = start + marker.length
  let result = ''
  while (i < partial.length) {
    const ch = partial[i]
    if (ch === '\\') {
      i++
      if (i < partial.length) {
        const esc = partial[i]
        if (esc === 'n') result += '\n'
        else if (esc === 't') result += '\t'
        else if (esc === '"') result += '"'
        else if (esc === '\\') result += '\\'
        else result += esc
        i++
      }
      continue
    }
    if (ch === '"') break
    result += ch
    i++
  }
  return result
}

function persistSession(goals) {
  apiFetch('/api/planner/session', {
    method: 'POST',
    body: JSON.stringify({ month: month.value, messages: messages.value, goals }),
  }).catch(() => {})
}

function stopAll() {
  if (isListening.value) stopListening()
  stopSpeaking()
  stopConvoRecognition(false)  // hard abort
}

function switchMode(newMode) {
  stopAll()
  mode.value = newMode
  convoStatus.value = 'idle'
  convoTranscript.value = ''
}

// ── AI call — streams response, pushes directly into messages ────────────────
async function callAI(msgList) {
  // Show typing indicator until first chunk arrives
  loading.value = true

  let accumulated = ''
  let msgIdx = -1
  const result = { message: '', goals: [] }

  try {
    for await (const event of apiStreamPublic('/api/planner/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages:     msgList,
        month:        month.value,
        mode:         mode.value,
        firstName:    props.firstName,
        priorContext: priorContext.value,
      }),
    })) {
      if (event.error) throw new Error(event.error)

      if (event.delta) {
        // First chunk: swap typing dots for a live message bubble
        if (msgIdx === -1) {
          loading.value = false
          messages.value.push({ role: 'assistant', content: '' })
          msgIdx = messages.value.length - 1
        }
        accumulated += event.delta
        const msg = extractStreamingMessage(accumulated)
        if (msg !== null) {
          messages.value[msgIdx].content = msg
          scrollToBottom()
        }
      }

      if (event.done) {
        // Finalise with the fully-parsed message
        if (msgIdx !== -1) messages.value[msgIdx].content = event.message
        result.message = event.message
        result.goals   = event.goals || []
      }
    }
  } finally {
    loading.value = false
  }

  return result
}

// ── Start planning (empty state) ──────────────────────────────────────────────
async function startPlanning() {
  started.value = true
  messages.value = []
  error.value    = ''
  try {
    const data = await callAI([])
    goalCount.value = data.goals?.length ?? 0
    persistSession(data.goals)
    if (convoMode.value) {
      await speakAI(data.message)
      startConvoListening()
    } else {
      await scrollToBottom()
    }
  } catch (e) {
    error.value   = e.message
    started.value = false
    messages.value = []
    convoStatus.value = 'idle'
  }
}

// ── TEXT MODE ─────────────────────────────────────────────────────────────────
function handleMic() {
  toggleListening(transcript => { input.value = transcript })
}

async function sendTextMessage() {
  const text = input.value.trim()
  if (!text || loading.value) return
  if (isListening.value) stopListening()
  input.value = ''
  await sendMessage(text)
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTextMessage() }
}

// ── CONVO MODE ────────────────────────────────────────────────────────────────

// Clear the silence debounce timer without touching the recognition session
function clearSilenceTimer() {
  if (_silenceTimer) { clearTimeout(_silenceTimer); _silenceTimer = null }
}

// Arm (or re-arm) the 1500ms silence timer that gracefully stops recognition
// once the user pauses speaking.  Every new final result resets the clock.
function armSilenceTimer(rec) {
  clearSilenceTimer()
  _silenceTimer = setTimeout(() => {
    _silenceTimer = null
    try { rec.stop() } catch {}  // triggers onend → sends accumulated text
  }, 1500)
}

/**
 * @param {boolean} graceful
 *   true  → rec.stop()  — finalises audio; onend still fires and sends text
 *   false → rec.abort() — discards audio;  increments _recId to block onend
 */
function stopConvoRecognition(graceful = false) {
  clearSilenceTimer()
  if (!graceful) _recId++
  if (convoRecognition) {
    try { graceful ? convoRecognition.stop() : convoRecognition.abort() } catch {}
    if (!graceful) convoRecognition = null
    // For graceful stop, let onend null out convoRecognition after processing
  }
}

function startConvoListening() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) { error.value = 'Voice input requires Chrome or Edge.'; return }

  stopConvoRecognition(false)   // hard-abort any previous session
  convoTranscript.value = ''
  convoStatus.value = 'listening'

  const myId = ++_recId         // snapshot this session's ID
  const rec  = new SR()
  convoRecognition = rec

  // continuous + interimResults: don't cut off on short pauses.
  // The silence debounce (1500 ms after last final result) sends the message.
  rec.continuous     = true
  rec.interimResults = true
  rec.lang           = 'en-US'

  let finalText = ''

  rec.onresult = (event) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        finalText += event.results[i][0].transcript + ' '
        armSilenceTimer(rec)    // reset 1500ms window on every final chunk
      } else {
        interim += event.results[i][0].transcript
      }
    }
    convoTranscript.value = (finalText + interim).trimEnd()
  }

  rec.onend = async () => {
    clearSilenceTimer()
    if (myId !== _recId) return   // hard-aborted by a newer session — ignore
    convoRecognition = null
    const text = finalText.trim()
    if (!text) {
      // Nothing captured — decide whether to restart or go idle
      if (convoStatus.value === 'listening') {
        // Browser ended on its own (network glitch / no-speech) — restart
        startConvoListening()
      } else {
        // Manually stopped with nothing said — back to idle
        convoStatus.value = 'idle'
      }
      return
    }
    convoTranscript.value = ''
    await sendConvoMessage(text)
  }

  rec.onerror = (e) => {
    if (myId !== _recId) return
    if (e.error === 'no-speech') return   // onend fires next and handles restart
    convoStatus.value = 'idle'
    error.value = `Mic error: ${e.error}`
  }

  rec.start()
}

async function sendConvoMessage(text) {
  messages.value.push({ role: 'user', content: text })
  convoStatus.value = 'processing'
  error.value = ''
  const userMsgIdx = messages.value.length - 1
  try {
    const data = await callAI(messages.value)
    goalCount.value = data.goals?.length ?? goalCount.value
    persistSession(data.goals)
    await speakAI(data.message)
    if (started.value) startConvoListening()
  } catch (e) {
    error.value = e.message
    messages.value.splice(userMsgIdx)
    convoStatus.value = 'idle'
  }
}

async function speakAI(text) {
  convoStatus.value = 'speaking'
  await speak(text)
  convoStatus.value = 'idle'
}

function toggleConvoMic() {
  if (convoStatus.value === 'listening') {
    // Graceful stop → onend fires → sends whatever was captured
    stopConvoRecognition(true)
    convoStatus.value = 'processing'
  } else if (convoStatus.value === 'idle') {
    startConvoListening()
  } else if (convoStatus.value === 'speaking') {
    stopSpeaking()
    startConvoListening()
  }
}

function endConvo() {
  stopAll()
  convoStatus.value = 'idle'
  convoTranscript.value = ''
}

// ── Shared send (text mode) ───────────────────────────────────────────────────
async function sendMessage(text) {
  messages.value.push({ role: 'user', content: text })
  error.value = ''
  await scrollToBottom()
  const userMsgIdx = messages.value.length - 1
  try {
    const data = await callAI(messages.value)
    goalCount.value = data.goals?.length ?? goalCount.value
    persistSession(data.goals)
    await scrollToBottom()
  } catch (e) {
    error.value = e.message
    // Remove user message and any empty streaming placeholder
    messages.value.splice(userMsgIdx)
  }
}

// ── Delete plan ───────────────────────────────────────────────────────────────
async function deletePlan() {
  if (!confirm(`Delete your ${monthLabel.value} plan and all goals? This cannot be undone.`)) return
  stopAll()
  deleting.value = true
  error.value    = ''
  try {
    await apiFetch(`/api/planner/${month.value}`, { method: 'DELETE' })
    messages.value        = []
    goalCount.value       = 0
    started.value         = false
    convoStatus.value     = 'idle'
    convoTranscript.value = ''
  } catch (e) {
    error.value = e.message
  } finally {
    deleting.value = false
  }
}

// Convo status labels
const convoStatusLabel = computed(() => ({
  idle:       '',
  listening:  'Listening…',
  processing: 'Thinking…',
  speaking:   'Speaking…',
}[convoStatus.value]))
</script>

<template>
  <div class="min-h-screen" style="background:var(--page-bg)">

    <!-- ── Hero Banner ──────────────────────────────────────────────────────────── -->
    <div class="relative overflow-hidden" style="background:linear-gradient(135deg,#0d5f6b 0%,#0b5060 40%,#0ea5e9 100%)">
      <div class="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/5 blur-3xl"></div>
      <div class="pointer-events-none absolute -bottom-10 left-1/4 h-48 w-48 rounded-full bg-cyan-300/10 blur-2xl"></div>

      <div class="relative mx-auto max-w-3xl px-6 py-10">
        <div class="flex items-center gap-5">
          <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 shadow-lg backdrop-blur-sm ring-1 ring-white/20">
            <CalendarDays class="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 class="text-2xl font-extrabold tracking-tight text-white drop-shadow-sm">Planner</h1>
            <p class="mt-0.5 text-sm font-medium text-cyan-100">Chat with your AI coach to set meaningful monthly goals.</p>
          </div>
        </div>
      </div>
    </div>

    <div class="mx-auto max-w-3xl px-4 py-8">

      <!-- ── Empty / start state ─────────────────────────────────────────────── -->
      <div v-if="!started" class="flex flex-col items-center justify-center gap-8 py-12 text-center animate-fade-up">
        <div class="animate-float flex h-24 w-24 items-center justify-center rounded-3xl shadow-2xl shadow-teal-500/20" style="background:linear-gradient(135deg,#0d5f6b,#0ea5e9)">
          <Zap class="h-12 w-12 text-white" />
        </div>

        <div class="space-y-2">
          <h2 class="text-2xl font-extrabold text-slate-800">Plan your {{ monthLabel }}</h2>
          <p class="mx-auto max-w-xs text-sm leading-relaxed text-slate-500">
            Chat with your AI coach to set clear, meaningful goals for the month ahead.
          </p>
        </div>

        <!-- Mode selector pill -->
        <div class="flex overflow-hidden rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
          <button
            @click="mode = 'text'"
            class="flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold transition-all duration-200"
            :class="mode === 'text'
              ? 'bg-gradient-to-r from-[#0d5f6b] to-[#0e7888] text-white shadow-md'
              : 'text-slate-500 hover:text-slate-700'"
          >
            <MessageSquare class="h-4 w-4" />
            Text
          </button>
          <button
            @click="mode = 'convo'"
            :disabled="!ttsSupported"
            class="flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40"
            :class="mode === 'convo'
              ? 'bg-gradient-to-r from-[#0d5f6b] to-[#0e7888] text-white shadow-md'
              : 'text-slate-500 hover:text-slate-700'"
            :title="!ttsSupported ? 'Voice output not supported in this browser' : ''"
          >
            <Mic class="h-4 w-4" />
            Convo
          </button>
        </div>

        <button
          @click="startPlanning"
          :disabled="loading"
          class="btn btn-primary flex items-center gap-2 rounded-2xl px-10 py-3.5 text-sm disabled:opacity-60"
        >
          <span v-if="loading" class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
          <Zap v-else class="h-4 w-4" />
          {{ loading ? 'Starting…' : 'Start Planning' }}
        </button>
      </div>

      <!-- ── Active session ─────────────────────────────────────────────────── -->
      <div v-else class="flex flex-col gap-4 animate-fade-up">

        <!-- Toolbar -->
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/60 bg-white px-4 py-3 shadow-sm">
          <!-- Month + mode -->
          <div class="flex items-center gap-3">
            <CalendarDays class="h-4 w-4 text-slate-400" />
            <span class="text-sm font-bold text-slate-700">{{ monthLabel }}</span>

            <!-- Mode toggle -->
            <div class="ml-1 flex overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              <button
                @click="switchMode('text')"
                class="flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all duration-200"
                :class="mode === 'text' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'"
              >
                <MessageSquare class="h-3 w-3" />Text
              </button>
              <button
                @click="switchMode('convo')"
                :disabled="!ttsSupported"
                class="flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all duration-200 disabled:opacity-40"
                :class="mode === 'convo' ? 'bg-gradient-to-r from-[#0d5f6b] to-[#0e7888] text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'"
              >
                <Mic class="h-3 w-3" />Convo
              </button>
            </div>
          </div>

          <!-- Action pills -->
          <div class="flex items-center gap-2">
            <button
              v-if="goalCount > 0"
              @click="emit('goToGoals')"
              class="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
            >
              <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"></span>
              {{ goalCount }} {{ goalCount === 1 ? 'goal' : 'goals' }}
              <ChevronRight class="h-3 w-3" />
            </button>

            <button
              v-if="goalCount > 0"
              @click="emit('startReview', month)"
              title="Start weekly progress review"
              class="flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-100"
            >
              <Target class="h-3.5 w-3.5" />
              Review
            </button>

            <button
              @click="deletePlan"
              :disabled="deleting"
              title="Delete plan and all goals for this month"
              class="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40"
            >
              <Trash2 class="h-4 w-4" />
            </button>
          </div>
        </div>

        <!-- Error -->
        <div v-if="error" class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{{ error }}</div>

        <!-- ── TEXT MODE ──────────────────────────────────────────────────────── -->
        <template v-if="mode === 'text'">
          <!-- Chat messages -->
          <div class="card p-5">
            <div ref="messagesEl" class="flex flex-col gap-4 min-h-[200px]">
              <div
                v-for="(msg, i) in messages"
                :key="i"
                class="flex animate-fade-up"
                :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
              >
                <!-- AI avatar -->
                <div
                  v-if="msg.role === 'assistant'"
                  class="mr-2.5 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl shadow-sm"
                  style="background:linear-gradient(135deg,#0d5f6b,#0ea5e9)"
                >
                  <Zap class="h-4 w-4 text-white" />
                </div>

                <div
                  class="max-w-[78%] whitespace-pre-wrap text-sm leading-relaxed"
                  :class="msg.role === 'user' ? 'bubble-user' : 'bubble-ai'"
                >{{ msg.content }}</div>
              </div>

              <!-- Typing indicator -->
              <div v-if="loading" class="flex justify-start animate-fade-in">
                <div
                  class="mr-2.5 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl shadow-sm"
                  style="background:linear-gradient(135deg,#0d5f6b,#0ea5e9)"
                >
                  <Zap class="h-4 w-4 text-white" />
                </div>
                <div class="bubble-ai flex items-center gap-1.5 px-4 py-3">
                  <span class="typing-dot"></span>
                  <span class="typing-dot"></span>
                  <span class="typing-dot"></span>
                </div>
              </div>
            </div>
          </div>

          <!-- Input row -->
          <div class="flex items-end gap-2">
            <MicButton :listening="isListening" :supported="speechSupported" @click="handleMic" />
            <textarea
              v-model="input"
              @keydown="onKeydown"
              rows="2"
              :placeholder="isListening ? 'Listening…' : 'Type your message… (Enter to send)'"
              :disabled="loading"
              class="input flex-1 resize-none"
              :class="isListening ? '!border-[#0d5f6b] !ring-4 !ring-[#0d5f6b]/10' : ''"
              style="border-radius:14px"
            />
            <button
              @click="sendTextMessage"
              :disabled="loading || !input.trim()"
              class="btn btn-primary flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl p-0 disabled:opacity-40"
            >
              <Send class="h-5 w-5" />
            </button>
          </div>
        </template>

        <!-- ── CONVO MODE ─────────────────────────────────────────────────────── -->
        <template v-else>
          <div class="card flex flex-col items-center gap-8 py-10">

            <!-- Last AI message bubble -->
            <div
              v-if="messages.length"
              class="w-full max-w-md rounded-2xl border border-slate-200/60 bg-slate-50 px-6 py-4 text-center text-sm leading-relaxed text-slate-700 shadow-inner"
            >
              {{ messages.filter(m => m.role === 'assistant').at(-1)?.content }}
            </div>

            <!-- Orb + controls -->
            <div class="flex flex-col items-center gap-5">

              <!-- TTS model download progress -->
              <div v-if="ttsLoading" class="flex flex-col items-center gap-3">
                <div class="relative h-28 w-28">
                  <svg class="h-28 w-28 -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#e2e8f0" stroke-width="8" />
                    <circle
                      cx="50" cy="50" r="40" fill="none"
                      stroke="#0d5f6b" stroke-width="8" stroke-linecap="round"
                      :stroke-dasharray="`${2 * Math.PI * 40}`"
                      :stroke-dashoffset="`${2 * Math.PI * 40 * (1 - loadProgress / 100)}`"
                      class="transition-all duration-300"
                    />
                  </svg>
                  <span class="absolute inset-0 flex items-center justify-center text-sm font-bold text-[#0d5f6b]">
                    {{ loadProgress }}%
                  </span>
                </div>
                <p class="text-sm font-semibold text-slate-600">Downloading voice model…</p>
                <p class="text-xs text-slate-400 text-center max-w-[200px]">Only happens once · ~82 MB · cached forever after</p>
              </div>

              <!-- Animated orb -->
              <button
                v-else
                @click="toggleConvoMic"
                class="relative h-28 w-28 rounded-full transition-transform duration-200 focus:outline-none hover:scale-105 active:scale-95"
                :disabled="convoStatus === 'processing'"
              >
                <!-- Outer ping ring -->
                <span
                  class="absolute inset-0 rounded-full"
                  :class="{
                    'animate-ping bg-[#0d5f6b] opacity-20': convoStatus === 'listening',
                    'animate-ping bg-emerald-500 opacity-20': convoStatus === 'speaking',
                  }"
                />
                <!-- Inner filled circle -->
                <span
                  class="absolute inset-2 rounded-full transition-all duration-300"
                  :class="{
                    'shadow-lg shadow-[#0d5f6b]/30': convoStatus === 'listening',
                    'shadow-lg shadow-emerald-500/30': convoStatus === 'speaking',
                  }"
                  :style="convoStatus === 'listening'
                    ? 'background:linear-gradient(135deg,#0d5f6b,#0a4a54)'
                    : convoStatus === 'speaking'
                    ? 'background:linear-gradient(135deg,#059669,#0d9488)'
                    : convoStatus === 'processing'
                    ? 'background:#e2e8f0'
                    : 'background:linear-gradient(135deg,#cbd5e1,#e2e8f0)'"
                />
                <!-- Icon inside orb -->
                <span class="absolute inset-0 flex items-center justify-center">
                  <svg
                    v-if="convoStatus !== 'speaking' && convoStatus !== 'processing'"
                    class="h-10 w-10 transition-colors duration-300"
                    :class="convoStatus === 'listening' ? 'text-white' : 'text-slate-500'"
                    viewBox="0 0 24 24" fill="currentColor"
                  >
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z"/>
                  </svg>
                  <span v-else-if="convoStatus === 'speaking'" class="flex h-8 items-end gap-1">
                    <span class="w-1.5 animate-bounce rounded-full bg-white" style="height:40%;animation-delay:0ms" />
                    <span class="w-1.5 animate-bounce rounded-full bg-white" style="height:80%;animation-delay:100ms" />
                    <span class="w-1.5 animate-bounce rounded-full bg-white" style="height:60%;animation-delay:200ms" />
                    <span class="w-1.5 animate-bounce rounded-full bg-white" style="height:100%;animation-delay:80ms" />
                    <span class="w-1.5 animate-bounce rounded-full bg-white" style="height:50%;animation-delay:160ms" />
                  </span>
                  <svg v-else class="h-9 w-9 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                </span>
              </button>

              <!-- Status label -->
              <p class="h-5 text-sm font-semibold text-slate-500">{{ convoStatusLabel }}</p>

              <!-- Live transcript -->
              <p v-if="convoTranscript" class="max-w-xs text-center text-sm italic leading-relaxed text-slate-600">
                "{{ convoTranscript }}"
              </p>

              <!-- Hint when idle -->
              <p v-if="convoStatus === 'idle'" class="max-w-[220px] text-center text-xs leading-relaxed text-slate-400">
                Tap the orb to speak — sends automatically after you pause
              </p>
            </div>

            <!-- End conversation -->
            <button
              @click="endConvo"
              class="btn btn-ghost rounded-xl px-5 py-2 text-xs text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
            >
              End conversation
            </button>
          </div>
        </template>

      </div>
    </div>
  </div>
</template>
