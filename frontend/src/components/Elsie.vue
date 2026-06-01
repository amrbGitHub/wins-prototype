<script setup>
import { ref, computed, onMounted } from 'vue'
import { useLcChat } from '../composables/useLcChat.js'
import LcActionCard from './LcActionCard.vue'
import {
  Sparkles, Send, RefreshCw, MessageSquare, Mic, X, Maximize2, AlertCircle,
} from 'lucide-vue-next'

const props = defineProps({ firstName: { type: String, default: '' } })
const emit  = defineEmits(['close', 'goals-updated', 'navigate'])

// Voice/text mode
const mode = ref('voice')

const {
  messages, error, streaming, chatEl,
  convoStatus, convoTranscript,
  lastAiMsg, lastActions, convoStatusLabel,
  ttsSupported,
  sttSupported, sttBackend, sttLoading, sttLoadProgress,
  reset, stopAll,
  runTextGreeting, sendTextMessage,
  runVoiceTurn, toggleConvoMic, cancelVoiceTurn,
  retryFromMessage, clickNavigateAction,
} = useLcChat({
  getFirstName:   () => props.firstName,
  onGoalsUpdated: () => emit('goals-updated'),
  onNavigate:     (id) => { emit('navigate', id); emit('close') },
})

// Voice is usable if both STT (native or Whisper) and TTS work in this browser.
const voiceCapable = computed(() => sttSupported.value && ttsSupported.value)

// Show a loading ring whenever either backend is downloading its model.
// Whisper loads on first mic tap (Firefox), Kokoro loads on first speak.
// Only Whisper (STT) has a loadable model now — ElevenLabs is server-side
// and the browser TTS fallback is instant. So progress UI reflects STT only.
const voiceModelLoading  = computed(() => sttLoading.value)
const voiceModelProgress = computed(() => sttLoadProgress.value)
const voiceModelLabel    = computed(() => 'Loading speech recognition…')

const textInput = ref('')

onMounted(async () => {
  mode.value = voiceCapable.value ? 'voice' : 'text'
  await startSession()
})

function switchMode(newMode) {
  if (mode.value === newMode) return
  stopAll()
  mode.value = newMode
}

async function startSession() {
  reset()
  if (mode.value === 'voice') await runVoiceTurn()
  else                         await runTextGreeting()
}

async function sendText() {
  const t = textInput.value
  textInput.value = ''
  await sendTextMessage(t)
}

function onTextEnter(e) {
  if (e.isComposing || e.keyCode === 229) return   // IME composition guard
  if (e.shiftKey) return
  e.preventDefault()
  sendText()
}
</script>

<template>
  <div
    role="dialog"
    aria-modal="true"
    aria-label="LC Learning Companion chat"
    class="flex flex-col overflow-hidden rounded-3xl"
    style="background:#fff;max-height:min(88vh,660px)"
  >

    <div class="relative overflow-hidden shrink-0"
         style="background:linear-gradient(135deg,#0b1a1c 0%,#0d5f6b 55%,#0e8095 100%)">
      <div class="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5 blur-2xl"></div>
      <div class="relative px-5 py-4 flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="relative shrink-0">
            <div class="h-10 w-10 rounded-xl flex items-center justify-center shadow ring-1 ring-white/20"
                 style="background:rgba(255,255,255,0.12);backdrop-filter:blur(8px)">
              <Sparkles class="h-5 w-5 text-teal-300" aria-hidden="true" />
            </div>
            <span class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 bg-emerald-400" style="border-color:#0b1a1c"></span>
          </div>
          <div>
            <p class="font-bold text-white text-sm leading-tight">LC</p>
            <p class="text-[11px] text-teal-200/70">Learning Companion</p>
          </div>
        </div>

        <div class="flex items-center gap-1.5">
          <div class="flex overflow-hidden rounded-lg ring-1 ring-white/15 bg-white/10 p-0.5" role="tablist" aria-label="Input mode">
            <button @click="switchMode('voice')" :disabled="!voiceCapable" :aria-pressed="mode === 'voice'" role="tab"
              class="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all disabled:opacity-40"
              :class="mode === 'voice' ? 'bg-white text-slate-700 shadow-sm' : 'text-white/70 hover:text-white'"
            ><Mic class="h-3 w-3" aria-hidden="true" />Voice</button>
            <button @click="switchMode('text')" :aria-pressed="mode === 'text'" role="tab"
              class="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all"
              :class="mode === 'text' ? 'bg-white text-slate-700 shadow-sm' : 'text-white/70 hover:text-white'"
            ><MessageSquare class="h-3 w-3" aria-hidden="true" />Text</button>
          </div>

          <button @click="startSession" :disabled="convoStatus === 'processing' || streaming" aria-label="New conversation"
            class="flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-white/20 text-white/70 hover:text-white hover:bg-white/15 transition disabled:opacity-40"
            style="background:rgba(255,255,255,0.08)">
            <RefreshCw class="h-3.5 w-3.5" :class="(convoStatus === 'processing' || streaming) ? 'animate-spin' : ''" aria-hidden="true" />
          </button>

          <button @click="emit('navigate', 'elsie')" aria-label="Open full view"
            class="flex h-8 w-8 items-center justify-center rounded-lg text-white/60 hover:text-white hover:bg-white/15 transition">
            <Maximize2 class="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          <button @click="emit('close')" aria-label="Close chat"
            class="flex h-8 w-8 items-center justify-center rounded-lg text-white/60 hover:text-white hover:bg-white/15 transition">
            <X class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>

    <!-- VOICE MODE -->
    <template v-if="mode === 'voice'">
      <div class="flex-1 flex flex-col items-center justify-center px-6 py-6 gap-5 overflow-y-auto">
        <Transition enter-active-class="transition duration-300 ease-out"
          enter-from-class="opacity-0 translate-y-3" enter-to-class="opacity-100 translate-y-0">
          <div v-if="lastAiMsg" class="w-full rounded-2xl border border-slate-100 bg-slate-50 px-5 py-3.5 text-center text-sm leading-relaxed text-slate-700">
            {{ lastAiMsg }}
          </div>
        </Transition>

        <div v-if="voiceModelLoading" class="flex flex-col items-center gap-3">
          <div class="relative h-24 w-24" role="progressbar" :aria-valuenow="voiceModelProgress" aria-valuemin="0" aria-valuemax="100" :aria-label="voiceModelLabel">
            <svg class="h-24 w-24 -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="50" cy="50" r="40" fill="none" stroke="#e2e8f0" stroke-width="7" />
              <circle cx="50" cy="50" r="40" fill="none" stroke="#0d5f6b" stroke-width="7" stroke-linecap="round"
                :stroke-dasharray="`${2 * Math.PI * 40}`"
                :stroke-dashoffset="`${2 * Math.PI * 40 * (1 - voiceModelProgress / 100)}`"
                class="transition-all duration-300" />
            </svg>
            <span class="absolute inset-0 flex items-center justify-center text-xs font-bold text-[#0d5f6b]">{{ voiceModelProgress }}%</span>
          </div>
          <p class="text-sm font-semibold text-slate-600">{{ voiceModelLabel }}</p>
          <p v-if="sttLoading" class="text-[10px] text-slate-400 max-w-[200px] text-center">
            One-time download (~75MB). Cached for future sessions.
          </p>
        </div>

        <button v-else @click="toggleConvoMic" :disabled="convoStatus === 'processing'"
          :aria-label="convoStatus === 'listening' ? 'Stop listening' : (convoStatus === 'speaking' ? 'Interrupt and speak' : 'Tap to speak')"
          class="relative h-28 w-28 rounded-full transition-transform duration-200 focus:outline-none hover:scale-105 active:scale-95 disabled:cursor-default disabled:hover:scale-100">
          <span class="absolute inset-0 rounded-full"
            :class="{
              'animate-ping bg-teal-500 opacity-20':    convoStatus === 'listening',
              'animate-ping bg-emerald-400 opacity-20': convoStatus === 'speaking',
            }" />
          <span class="absolute inset-2 rounded-full shadow-xl transition-all duration-500"
            :style="convoStatus === 'listening'
              ? 'background:linear-gradient(135deg,#0d5f6b,#0e8095);box-shadow:0 0 36px rgba(13,95,107,0.50)'
              : convoStatus === 'speaking'
              ? 'background:linear-gradient(135deg,#059669,#0d9488);box-shadow:0 0 36px rgba(5,150,105,0.45)'
              : convoStatus === 'processing'
              ? 'background:#e2e8f0'
              : 'background:linear-gradient(135deg,#334155,#475569);box-shadow:0 0 20px rgba(0,0,0,0.12)'" />
          <span class="absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <svg v-if="convoStatus === 'idle' || convoStatus === 'listening'"
              class="h-10 w-10 transition-colors duration-300"
              :class="convoStatus === 'listening' ? 'text-white' : 'text-slate-400'"
              viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z"/>
            </svg>
            <span v-else-if="convoStatus === 'speaking'" class="flex h-8 items-end gap-1">
              <span class="w-1.5 animate-bounce rounded-full bg-white" style="height:35%;animation-delay:0ms"/>
              <span class="w-1.5 animate-bounce rounded-full bg-white" style="height:75%;animation-delay:90ms"/>
              <span class="w-1.5 animate-bounce rounded-full bg-white" style="height:55%;animation-delay:180ms"/>
              <span class="w-1.5 animate-bounce rounded-full bg-white" style="height:95%;animation-delay:60ms"/>
              <span class="w-1.5 animate-bounce rounded-full bg-white" style="height:45%;animation-delay:150ms"/>
            </span>
            <svg v-else class="h-9 w-9 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </span>
        </button>

        <div class="flex flex-col items-center gap-2 min-h-[64px] w-full" aria-live="polite">
          <p class="text-sm font-semibold text-slate-500 h-5">{{ convoStatusLabel }}</p>
          <!-- Live transcription. Native SR fills this as the user speaks;
               Whisper fills it once after the user taps to stop. Persists
               through processing + speaking so the user can re-read it. -->
          <p v-if="convoTranscript" class="w-full max-w-[300px] text-center text-sm leading-snug text-slate-700 font-medium px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-100">
            {{ convoTranscript }}
          </p>
          <p v-else-if="convoStatus === 'idle' && lastAiMsg" class="text-[11px] text-slate-400 text-center">
            Tap to start speaking
          </p>
        </div>

        <!-- Hard-cancel button — visible whenever voice is doing something.
             One-click escape hatch: aborts STT, kills any in-flight LLM
             request, stops TTS, returns straight to idle. -->
        <button
          v-if="convoStatus !== 'idle'"
          @click="cancelVoiceTurn"
          class="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 shadow-sm hover:bg-slate-50 hover:border-slate-400 transition"
          aria-label="Cancel current voice turn"
        >
          <X class="h-3.5 w-3.5" aria-hidden="true" />
          Stop
        </button>

        <div v-if="lastActions.length" class="w-full flex flex-col gap-1.5">
          <LcActionCard v-for="(action, ai) in lastActions" :key="action._id"
            :action="action" density="compact"
            @navigate="clickNavigateAction(messages.length - 1, ai)" />
        </div>

        <div v-if="error" class="flex items-center gap-2 max-w-xs rounded-lg bg-rose-50 border border-rose-100 px-3 py-2">
          <AlertCircle class="h-4 w-4 text-rose-500 shrink-0" aria-hidden="true" />
          <span class="text-xs text-rose-600 flex-1">{{ error }}</span>
          <button v-if="messages.length" @click="retryFromMessage(messages.length - 1)"
            class="inline-flex items-center gap-1 rounded-md bg-white border border-rose-200 px-2 py-0.5 text-[10px] font-bold text-rose-700 hover:bg-rose-100 transition">
            <RefreshCw class="h-2.5 w-2.5" aria-hidden="true" />Retry
          </button>
        </div>
      </div>
    </template>

    <!-- TEXT MODE -->
    <template v-else>
      <div ref="chatEl" class="flex-1 overflow-y-auto">
        <div class="px-4 py-4 flex flex-col gap-4">
          <p v-if="error" class="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{{ error }}</p>

          <div v-for="(msg, msgIdx) in messages" :key="msg._id">
            <div v-if="msg.role === 'assistant'" class="flex items-start gap-2.5">
              <div class="shrink-0 h-7 w-7 rounded-lg flex items-center justify-center shadow-sm mt-0.5"
                   style="background:linear-gradient(135deg,#0d5f6b,#0e8095)" aria-hidden="true">
                <Sparkles class="h-3.5 w-3.5 text-white" />
              </div>
              <div class="flex flex-col gap-2 flex-1 min-w-0">
                <div v-if="streaming && msgIdx === messages.length - 1 && !msg.content"
                     class="bubble-ai inline-flex items-center gap-1.5 w-fit text-xs">
                  <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
                </div>
                <div v-else-if="msg.content" class="bubble-ai whitespace-pre-wrap text-[13px]">{{ msg.content }}</div>

                <div v-if="msg.failed && !(streaming && msgIdx === messages.length - 1)"
                     class="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] w-fit">
                  <AlertCircle class="h-4 w-4 text-rose-500 shrink-0" aria-hidden="true" />
                  <span class="text-rose-700 font-medium">{{ msg.errorMsg || "LC didn't respond clearly." }}</span>
                  <button @click="retryFromMessage(msgIdx)" :disabled="streaming"
                    class="ml-1 inline-flex items-center gap-1 rounded-lg bg-white border border-rose-200 px-2 py-0.5 text-[11px] font-bold text-rose-700 hover:bg-rose-100 transition disabled:opacity-40">
                    <RefreshCw class="h-3 w-3" aria-hidden="true" />Retry
                  </button>
                </div>

                <div v-if="msg.actions?.length && !(streaming && msgIdx === messages.length - 1)" class="flex flex-col gap-1.5 w-full max-w-full">
                  <LcActionCard v-for="(action, ai) in msg.actions" :key="action._id"
                    :action="action" density="compact"
                    @navigate="clickNavigateAction(msgIdx, ai)" />
                </div>
              </div>
            </div>
            <div v-else class="flex justify-end">
              <div class="bubble-user max-w-[80%] text-[13px]">{{ msg.content }}</div>
            </div>
          </div>
          <div class="h-1"></div>
        </div>
      </div>

      <div class="shrink-0 px-3 py-3 border-t" style="border-color:rgba(0,0,0,0.06)">
        <div class="flex items-end gap-2">
          <label class="sr-only" for="lc-overlay-input">Type your message to LC</label>
          <textarea id="lc-overlay-input" v-model="textInput" @keydown.enter="onTextEnter"
            placeholder="Talk to LC…" rows="1" :disabled="streaming"
            class="input flex-1 resize-none leading-relaxed disabled:opacity-50 text-[13px]"
            style="min-height:40px;max-height:120px;overflow-y:auto" />
          <button @click="sendText" :disabled="!textInput.trim() || streaming" aria-label="Send message"
            class="btn btn-primary shrink-0 disabled:opacity-40" style="padding:9px 14px">
            <Send class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </template>

  </div>
</template>
