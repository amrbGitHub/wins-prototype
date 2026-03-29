<script setup>
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { useApi } from '../composables/useApi.js'
import { useSpeech } from '../composables/useSpeech.js'
import { useTTS } from '../composables/useTTS.js'
import MicButton from './MicButton.vue'

const emit = defineEmits(['goToGoals'])
const { apiFetch, apiFetchPublic } = useApi()

// Text-mode STT
const { isSupported: speechSupported, isListening, toggleListening, stopListening } = useSpeech()
// TTS for Convo mode
const { isSupported: ttsSupported, isSpeaking, speak, stop: stopSpeaking } = useTTS()

// ── Shared state ──────────────────────────────────────────────────────────────
const month      = ref(new Date().toISOString().slice(0, 7))
const messages   = ref([])
const loading    = ref(false)
const deleting   = ref(false)
const goalCount  = ref(0)
const started    = ref(false)
const error      = ref('')
const mode       = ref('text')   // 'text' | 'convo'

// Text mode
const input      = ref('')
const messagesEl = ref(null)

// Convo mode
// 'idle' | 'listening' | 'processing' | 'speaking'
const convoStatus     = ref('idle')
const convoTranscript = ref('')   // live STT transcript shown in UI
let   convoRecognition = null

const monthLabel = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
})

const convoMode = computed(() => mode.value === 'convo')

// ── Session loading ───────────────────────────────────────────────────────────
async function loadSession() {
  try {
    const [sessionData, goalsData] = await Promise.all([
      apiFetch(`/api/planner/${month.value}`),
      apiFetch(`/api/goals?month=${month.value}`).catch(() => []),
    ])
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

// ── Month navigation ──────────────────────────────────────────────────────────
async function shiftMonth(delta) {
  const [y, m] = month.value.split('-').map(Number)
  const d = new Date(y, m - 1 + delta)
  month.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  stopAll()
  input.value        = ''
  error.value        = ''
  convoTranscript.value = ''
  convoStatus.value  = 'idle'
  await loadSession()
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function scrollToBottom() {
  await nextTick()
  messagesEl.value?.lastElementChild?.scrollIntoView({ behavior: 'smooth' })
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
  stopConvoRecognition()
}

function switchMode(newMode) {
  stopAll()
  mode.value = newMode
  convoStatus.value = 'idle'
  convoTranscript.value = ''
}

// ── AI call (shared by both modes) ───────────────────────────────────────────
async function callAI(msgList) {
  const data = await apiFetchPublic('/api/planner/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: msgList, month: month.value }),
  })
  return data
}

// ── Start planning (empty state) ──────────────────────────────────────────────
async function startPlanning() {
  started.value = true
  loading.value = true
  error.value   = ''
  try {
    const data = await callAI([])
    messages.value  = [{ role: 'assistant', content: data.message }]
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
    convoStatus.value = 'idle'
  } finally {
    loading.value = false
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
function stopConvoRecognition() {
  if (convoRecognition) {
    try { convoRecognition.abort() } catch {}
    convoRecognition = null
  }
}

function startConvoListening() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) { error.value = 'Voice input requires Chrome or Edge.'; return }

  stopConvoRecognition()
  convoTranscript.value = ''
  convoStatus.value = 'listening'

  const rec = new SR()
  convoRecognition = rec
  rec.continuous      = false   // single utterance — auto-sends on silence
  rec.interimResults  = true
  rec.lang            = 'en-US'

  let finalText = ''

  rec.onresult = (event) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) finalText += event.results[i][0].transcript + ' '
      else interim += event.results[i][0].transcript
    }
    convoTranscript.value = (finalText + interim).trimEnd()
  }

  rec.onend = async () => {
    convoRecognition = null
    const text = finalText.trim()
    if (!text) {
      // Nothing captured — go back to listening if still in convo
      if (convoStatus.value === 'listening') startConvoListening()
      return
    }
    convoTranscript.value = ''
    await sendConvoMessage(text)
  }

  rec.onerror = (e) => {
    if (e.error === 'no-speech') {
      // timeout with no speech — restart
      startConvoListening()
      return
    }
    convoStatus.value = 'idle'
    error.value = `Mic error: ${e.error}`
  }

  rec.start()
}

async function sendConvoMessage(text) {
  messages.value.push({ role: 'user', content: text })
  convoStatus.value = 'processing'
  error.value = ''
  try {
    const data = await callAI(messages.value)
    messages.value.push({ role: 'assistant', content: data.message })
    goalCount.value = data.goals?.length ?? goalCount.value
    persistSession(data.goals)
    // Speak the response, then auto-restart listening
    await speakAI(data.message)
    if (started.value) startConvoListening()
  } catch (e) {
    error.value = e.message
    messages.value.pop()
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
    // Manually stop → fires rec.onend which will auto-send
    stopConvoRecognition()
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

// ── Shared send (used by text mode) ──────────────────────────────────────────
async function sendMessage(text) {
  messages.value.push({ role: 'user', content: text })
  loading.value = true
  error.value   = ''
  await scrollToBottom()
  try {
    const data = await callAI(messages.value)
    messages.value.push({ role: 'assistant', content: data.message })
    goalCount.value = data.goals?.length ?? goalCount.value
    persistSession(data.goals)
    await scrollToBottom()
  } catch (e) {
    error.value = e.message
    messages.value.pop()
  } finally {
    loading.value = false
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
  <main class="mx-auto max-w-3xl px-4 py-8">

    <!-- ── Empty state ──────────────────────────────────────────────────────── -->
    <div v-if="!started" class="flex flex-col items-center justify-center min-h-[62vh] gap-6 text-center">

      <!-- Month picker -->
      <div class="flex items-center gap-1">
        <button @click="shiftMonth(-1)" class="rounded-xl border border-slate-200/70 bg-white p-2 hover:bg-slate-50 transition shadow-sm">
          <svg class="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <span class="text-sm font-semibold text-slate-600 min-w-[140px] text-center">{{ monthLabel }}</span>
        <button @click="shiftMonth(1)" class="rounded-xl border border-slate-200/70 bg-white p-2 hover:bg-slate-50 transition shadow-sm">
          <svg class="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>

      <div class="h-20 w-20 rounded-3xl bg-gradient-to-br from-[#0d5f6b]/10 to-[#0a4a54]/5 flex items-center justify-center shadow-inner">
        <svg class="h-10 w-10 text-[#0d5f6b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
        </svg>
      </div>

      <div class="space-y-1.5">
        <h2 class="text-2xl font-bold text-slate-800">Plan your {{ monthLabel }}</h2>
        <p class="text-slate-500 text-sm max-w-xs mx-auto leading-relaxed">
          Chat with your AI coach to set clear, meaningful goals for the month ahead.
        </p>
      </div>

      <!-- Mode selector -->
      <div class="flex rounded-2xl border border-slate-200/60 bg-slate-50/80 p-0.5 shadow-inner">
        <button
          @click="mode = 'text'"
          class="flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold transition-all duration-200"
          :class="mode === 'text'
            ? 'bg-white text-slate-800 shadow-sm'
            : 'text-slate-400 hover:text-slate-600'"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
          </svg>
          Text
        </button>
        <button
          @click="mode = 'convo'"
          :disabled="!ttsSupported"
          class="flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
          :class="mode === 'convo'
            ? 'bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] text-white shadow-md shadow-[#0d5f6b]/20'
            : 'text-slate-400 hover:text-slate-600'"
          :title="!ttsSupported ? 'Voice output not supported in this browser' : ''"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
          </svg>
          Convo
        </button>
      </div>

      <button
        @click="startPlanning"
        :disabled="loading"
        class="rounded-2xl bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[#0d5f6b]/25 hover:shadow-xl hover:shadow-[#0d5f6b]/30 transition-all duration-200 hover:-translate-y-0.5 disabled:opacity-60"
      >
        {{ loading ? 'Starting…' : 'Start Planning' }}
      </button>
    </div>

    <!-- ── Active session ────────────────────────────────────────────────────── -->
    <div v-else class="flex flex-col gap-5">

      <!-- Toolbar -->
      <div class="flex items-center justify-between gap-3">
        <!-- Month nav -->
        <div class="flex items-center gap-1">
          <button @click="shiftMonth(-1)" class="rounded-xl border border-slate-200/70 bg-white p-1.5 hover:bg-slate-50 transition shadow-sm">
            <svg class="h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <span class="text-xs font-semibold text-slate-500 min-w-[110px] text-center">{{ monthLabel }}</span>
          <button @click="shiftMonth(1)" class="rounded-xl border border-slate-200/70 bg-white p-1.5 hover:bg-slate-50 transition shadow-sm">
            <svg class="h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>

        <div class="flex items-center gap-2">
          <!-- Mode toggle -->
          <div class="flex rounded-xl border border-slate-200/60 bg-slate-50/80 p-0.5">
            <button
              @click="switchMode('text')"
              class="rounded-lg px-3 py-1 text-xs font-semibold transition-all duration-200"
              :class="mode === 'text' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'"
            >Text</button>
            <button
              @click="switchMode('convo')"
              :disabled="!ttsSupported"
              class="rounded-lg px-3 py-1 text-xs font-semibold transition-all duration-200 disabled:opacity-40"
              :class="mode === 'convo' ? 'bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'"
            >Convo</button>
          </div>

          <!-- Goals pill -->
          <button
            v-if="goalCount > 0"
            @click="emit('goToGoals')"
            class="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition"
          >
            <span class="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {{ goalCount }} {{ goalCount === 1 ? 'goal' : 'goals' }}
            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
          </button>

          <!-- Delete -->
          <button
            @click="deletePlan"
            :disabled="deleting"
            title="Delete plan and all goals for this month"
            class="rounded-xl border border-slate-200/70 bg-white p-1.5 text-slate-400 hover:text-rose-500 hover:border-rose-200 hover:bg-rose-50 transition disabled:opacity-40"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Error -->
      <p v-if="error" class="text-sm text-rose-500 bg-rose-50 border border-rose-100 rounded-xl px-4 py-2.5">{{ error }}</p>

      <!-- ══ TEXT MODE ══════════════════════════════════════════════════════════ -->
      <template v-if="mode === 'text'">
        <!-- Messages -->
        <div ref="messagesEl" class="flex flex-col gap-3">
          <div
            v-for="(msg, i) in messages" :key="i"
            class="flex" :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
          >
            <div v-if="msg.role === 'assistant'" class="mr-2 mt-1 h-7 w-7 shrink-0 rounded-xl bg-gradient-to-br from-[#0d5f6b] to-[#0a4a54] flex items-center justify-center shadow-sm">
              <span class="text-white text-xs font-bold">W</span>
            </div>
            <div
              class="max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap"
              :class="msg.role === 'user'
                ? 'bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] text-white rounded-br-sm shadow-md shadow-[#0d5f6b]/15'
                : 'bg-white border border-slate-200/70 text-slate-700 rounded-bl-sm shadow-sm'"
            >{{ msg.content }}</div>
          </div>

          <!-- Typing indicator -->
          <div v-if="loading" class="flex justify-start">
            <div class="mr-2 mt-1 h-7 w-7 shrink-0 rounded-xl bg-gradient-to-br from-[#0d5f6b] to-[#0a4a54] flex items-center justify-center shadow-sm">
              <span class="text-white text-xs font-bold">W</span>
            </div>
            <div class="bg-white border border-slate-200/70 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm flex gap-1.5 items-center">
              <span class="h-2 w-2 rounded-full bg-slate-300 animate-bounce" style="animation-delay:0ms" />
              <span class="h-2 w-2 rounded-full bg-slate-300 animate-bounce" style="animation-delay:160ms" />
              <span class="h-2 w-2 rounded-full bg-slate-300 animate-bounce" style="animation-delay:320ms" />
            </div>
          </div>
        </div>

        <!-- Input row -->
        <div class="flex gap-2 mt-1 items-end">
          <MicButton :listening="isListening" :supported="speechSupported" @click="handleMic" />
          <textarea
            v-model="input"
            @keydown="onKeydown"
            rows="2"
            :placeholder="isListening ? 'Listening…' : 'Type your response… (Enter to send)'"
            :disabled="loading"
            class="flex-1 resize-none rounded-2xl border border-slate-200/70 bg-white px-4 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#0d5f6b]/30 focus:border-[#0d5f6b]/50 disabled:opacity-50 transition placeholder:text-slate-400"
            :class="isListening ? 'border-[#0d5f6b]/40 ring-2 ring-[#0d5f6b]/20' : ''"
          />
          <button
            @click="sendTextMessage"
            :disabled="loading || !input.trim()"
            class="rounded-2xl bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] p-3 text-white shadow-md hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5 disabled:opacity-40"
          >
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
      </template>

      <!-- ══ CONVO MODE ═════════════════════════════════════════════════════════ -->
      <template v-else>
        <div class="flex flex-col items-center gap-8 py-6">

          <!-- Last AI message (shown while speaking or idle) -->
          <div
            v-if="messages.length"
            class="w-full rounded-2xl border border-slate-200/70 bg-white px-5 py-4 shadow-sm text-sm text-slate-700 leading-relaxed text-center max-w-md"
          >
            {{ messages.filter(m => m.role === 'assistant').at(-1)?.content }}
          </div>

          <!-- Orb + status -->
          <div class="flex flex-col items-center gap-4">

            <!-- Animated orb button -->
            <button
              @click="toggleConvoMic"
              class="relative h-24 w-24 rounded-full focus:outline-none transition-transform duration-200 hover:scale-105 active:scale-95"
              :disabled="convoStatus === 'processing'"
            >
              <!-- Outer ring pulses when listening or speaking -->
              <span
                class="absolute inset-0 rounded-full"
                :class="{
                  'bg-[#0d5f6b] animate-ping opacity-20': convoStatus === 'listening',
                  'bg-emerald-500 animate-ping opacity-20': convoStatus === 'speaking',
                }"
              />
              <!-- Inner circle -->
              <span
                class="absolute inset-2 rounded-full transition-all duration-300"
                :class="{
                  'bg-gradient-to-br from-[#0d5f6b] to-[#0a4a54] shadow-lg shadow-[#0d5f6b]/30': convoStatus === 'listening',
                  'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/30': convoStatus === 'speaking',
                  'bg-slate-200': convoStatus === 'processing',
                  'bg-gradient-to-br from-slate-200 to-slate-300': convoStatus === 'idle',
                }"
              />
              <!-- Icon -->
              <span class="absolute inset-0 flex items-center justify-center">
                <!-- Mic when listening or idle -->
                <svg
                  v-if="convoStatus !== 'speaking' && convoStatus !== 'processing'"
                  class="h-9 w-9 transition-colors duration-300"
                  :class="convoStatus === 'listening' ? 'text-white' : 'text-slate-500'"
                  viewBox="0 0 24 24" fill="currentColor"
                >
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z"/>
                </svg>
                <!-- Waveform bars when speaking -->
                <span v-else-if="convoStatus === 'speaking'" class="flex gap-1 items-end h-8">
                  <span class="w-1.5 rounded-full bg-white animate-bounce" style="height:40%;animation-delay:0ms" />
                  <span class="w-1.5 rounded-full bg-white animate-bounce" style="height:80%;animation-delay:100ms" />
                  <span class="w-1.5 rounded-full bg-white animate-bounce" style="height:60%;animation-delay:200ms" />
                  <span class="w-1.5 rounded-full bg-white animate-bounce" style="height:100%;animation-delay:80ms" />
                  <span class="w-1.5 rounded-full bg-white animate-bounce" style="height:50%;animation-delay:160ms" />
                </span>
                <!-- Spinner when processing -->
                <svg v-else class="h-8 w-8 text-slate-400 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              </span>
            </button>

            <!-- Status label -->
            <p class="text-sm font-semibold text-slate-500 h-5">{{ convoStatusLabel }}</p>

            <!-- Live transcript while listening -->
            <p v-if="convoTranscript" class="text-sm text-slate-600 italic text-center max-w-xs leading-relaxed">
              "{{ convoTranscript }}"
            </p>

            <!-- Hint text when idle -->
            <p v-if="convoStatus === 'idle'" class="text-xs text-slate-400 text-center max-w-[200px] leading-relaxed">
              Tap the mic to speak — it will auto-send when you pause
            </p>
          </div>

          <!-- End conversation -->
          <button
            @click="endConvo"
            class="rounded-xl border border-slate-200/70 bg-white px-4 py-2 text-xs font-semibold text-slate-500 hover:text-rose-500 hover:border-rose-200 hover:bg-rose-50 transition shadow-sm"
          >
            End conversation
          </button>
        </div>
      </template>

    </div>
  </main>
</template>
