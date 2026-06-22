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
  lastAiMsg, lastActions, convoStatusLabel, thinkingVerb,
  ttsSupported, ttsLevels,
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

// Mean of the live audio bins — drives the orb's halo/glow intensity so
// the whole sphere visibly pulses with LC's voice, not just the bars.
const avgLevel = computed(() => {
  const arr = ttsLevels.value || []
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
})

// Secondary control label — explicit per state so it can't be confused
// with the orb's affirmative action. Listening: discard the speech without
// sending. Processing: abort the in-flight LLM call. Speaking: end LC's
// response without starting a new recording (orb-tap would interrupt + listen).
const cancelLabel = computed(() => {
  if (convoStatus.value === 'listening')  return { text: 'Discard', aria: "Discard what you've said without sending" }
  if (convoStatus.value === 'processing') return { text: 'Cancel',  aria: 'Cancel the current request' }
  if (convoStatus.value === 'speaking')   return { text: 'End',     aria: 'Stop LC and end this turn' }
  return { text: 'Cancel', aria: 'Cancel' }
})

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
          :aria-label="convoStatus === 'listening' ? 'Tap to send' : (convoStatus === 'speaking' ? 'Interrupt LC and speak' : 'Tap to speak')"
          class="lc-orb relative h-28 w-28 rounded-full transition-transform duration-200 focus:outline-none hover:scale-105 active:scale-95 disabled:cursor-default disabled:hover:scale-100"
          :class="{
            'lc-orb--listening':  convoStatus === 'listening',
            'lc-orb--speaking':   convoStatus === 'speaking',
            'lc-orb--processing': convoStatus === 'processing',
            'lc-orb--idle':       convoStatus === 'idle',
          }"
          :style="`--lvl:${avgLevel}`">
          <!-- Outer halo: blurred aurora ring; expands & brightens with avgLevel during speech -->
          <span class="lc-orb__halo absolute -inset-3 rounded-full pointer-events-none" />
          <!-- Conic aurora gradient that slowly rotates -->
          <span class="lc-orb__aurora absolute inset-0 rounded-full overflow-hidden" />
          <!-- Glass disc + radial highlight on top -->
          <span class="lc-orb__glass absolute inset-1.5 rounded-full" />
          <span class="absolute inset-0 flex items-center justify-center z-10" aria-hidden="true">
            <svg v-if="convoStatus === 'idle' || convoStatus === 'listening'"
              class="h-10 w-10 transition-colors duration-300"
              :class="convoStatus === 'listening' ? 'text-white' : 'text-slate-400'"
              viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z"/>
            </svg>
            <!-- Speaking visualizer. 5 bars whose heights track the live audio
                 amplitude from ElevenLabs (driven by ttsLevels). When ttsLevels
                 stays at zero (browser-TTS fallback can't be sampled), the
                 reactive value falls back to a gentle canned bounce so the
                 user still sees motion. -->
            <span v-else-if="convoStatus === 'speaking'" class="flex h-8 items-end gap-1">
              <span v-for="(lvl, i) in ttsLevels" :key="i"
                class="w-1.5 rounded-full bg-white transition-all duration-75 ease-out"
                :class="{ 'animate-bounce': lvl === 0 }"
                :style="lvl > 0
                  ? `height:${15 + lvl * 85}%`
                  : `height:${[35,75,55,95,45][i]}%;animation-delay:${[0,90,180,60,150][i]}ms`" />
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
            Tap the orb to speak
          </p>
          <p v-else-if="convoStatus === 'listening'" class="text-[11px] text-slate-400 text-center">
            Tap the orb again to send
          </p>
        </div>

        <!-- Secondary escape hatch — distinct from the orb. Orb-tap finishes
             the current state cleanly (listening → send, speaking → interrupt
             and start listening). This button discards/aborts instead.
             Label varies by state so the difference is unambiguous. -->
        <button
          v-if="convoStatus !== 'idle'"
          @click="cancelVoiceTurn"
          class="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 shadow-sm hover:bg-slate-50 hover:border-slate-400 transition"
          :aria-label="cancelLabel.aria"
        >
          <X class="h-3.5 w-3.5" aria-hidden="true" />
          {{ cancelLabel.text }}
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

        <!-- Voice privacy notice (cybersec audit Finding #14). Speech is
             transcribed locally when Whisper is available and via your
             browser's native engine otherwise; the resulting text is
             pseudonymized before any AI call. No audio is retained. -->
        <p class="mt-2 text-[10px] text-slate-400 text-center max-w-[260px] leading-snug">
          Voice is transcribed in your browser; the text (with names
          pseudonymized) is sent to the AI. No audio is stored.
          AI responses can be wrong — please review before acting.
        </p>
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
                     class="bubble-ai inline-flex items-center gap-2 w-fit text-xs">
                  <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
                  <span class="text-slate-500 italic transition-opacity duration-300">{{ thinkingVerb }}</span>
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

                <div v-if="msg.citations?.length && !(streaming && msgIdx === messages.length - 1)"
                     class="mt-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                  <p class="font-semibold text-slate-500 uppercase tracking-wider text-[10px] mb-1.5">Sources</p>
                  <ol class="space-y-1 list-decimal list-inside marker:text-slate-400 marker:font-medium">
                    <li v-for="c in msg.citations" :key="c.url" class="text-slate-700">
                      <a :href="c.url" target="_blank" rel="noopener noreferrer"
                         class="text-teal-700 hover:text-teal-900 underline underline-offset-2">
                        {{ c.title || c.url }}
                      </a>
                    </li>
                  </ol>
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
        <!-- AI accuracy disclaimer (cybersec audit Finding #16). -->
        <p class="mt-1.5 text-[10px] text-slate-400 text-center leading-snug">
          LC can make mistakes. Check important info before relying on it.
        </p>
      </div>
    </template>

  </div>
</template>

<style scoped>
/* ── LC voice orb ──────────────────────────────────────────────────────────
   Layered look:
     .lc-orb__halo    soft blurred aura behind the sphere (breathes with audio)
     .lc-orb__aurora  rotating conic gradient — the "iridescent" surface
     .lc-orb__glass   inner dark glass disc with a top-left highlight
     button content   icon / bars sit on top
   --lvl is a CSS custom property set from avgLevel (0..1) when speaking,
   so the halo intensifies and breathes in time with LC's voice.
   ────────────────────────────────────────────────────────────────────── */

.lc-orb__halo,
.lc-orb__aurora,
.lc-orb__glass {
  transition: opacity 350ms ease, background 400ms ease, box-shadow 400ms ease;
}

/* Layer order */
.lc-orb__halo   { z-index: 0; }
.lc-orb__aurora { z-index: 1; }
.lc-orb__glass  { z-index: 2; }

/* ── Halo (outer aura) ───────────────────────────────────────────────────── */
.lc-orb__halo {
  background: conic-gradient(
    from 0deg,
    rgba(45, 212, 191, 0.55),    /* teal */
    rgba(99, 102, 241, 0.55),    /* indigo */
    rgba(217, 70, 239, 0.55),    /* fuchsia */
    rgba(45, 212, 191, 0.55)
  );
  filter: blur(14px);
  opacity: 0;
  transform: scale(0.96);
}

/* ── Aurora ring (conic gradient, slowly rotating) ───────────────────────── */
.lc-orb__aurora {
  background: conic-gradient(
    from var(--rot, 0deg),
    #2dd4bf 0deg,
    #6366f1 110deg,
    #d946ef 220deg,
    #2dd4bf 360deg
  );
  animation: lcOrbSpin 9s linear infinite;
  opacity: 0;
}

@keyframes lcOrbSpin {
  to { transform: rotate(360deg); }
}

/* ── Glass disc (the dark sphere with a soft highlight) ──────────────────── */
.lc-orb__glass {
  background:
    radial-gradient(circle at 30% 28%, rgba(255,255,255,0.32), rgba(255,255,255,0) 55%),
    linear-gradient(160deg, #0f172a 0%, #1e293b 60%, #0b1220 100%);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.10),
    inset 0 -10px 24px rgba(0,0,0,0.45),
    0 6px 20px rgba(2, 6, 23, 0.35);
}

/* ── State variants ──────────────────────────────────────────────────────── */

/* Idle: muted slate sphere, very subtle aurora */
.lc-orb--idle .lc-orb__aurora { opacity: 0.25; animation-duration: 22s; }
.lc-orb--idle .lc-orb__halo   { opacity: 0; }
.lc-orb--idle .lc-orb__glass {
  background:
    radial-gradient(circle at 30% 28%, rgba(255,255,255,0.22), rgba(255,255,255,0) 55%),
    linear-gradient(160deg, #1e293b 0%, #334155 60%, #1e293b 100%);
}

/* Listening: full aurora, gentle teal halo */
.lc-orb--listening .lc-orb__aurora { opacity: 0.95; animation-duration: 7s; }
.lc-orb--listening .lc-orb__halo {
  opacity: 0.55;
  transform: scale(1.02);
  animation: lcOrbHaloBreath 2.6s ease-in-out infinite;
}

@keyframes lcOrbHaloBreath {
  0%, 100% { opacity: 0.5;  transform: scale(1.00); }
  50%      { opacity: 0.78; transform: scale(1.06); }
}

/* Processing: dim, paused aurora */
.lc-orb--processing .lc-orb__aurora { opacity: 0.35; animation-play-state: paused; }
.lc-orb--processing .lc-orb__halo   { opacity: 0.18; }
.lc-orb--processing .lc-orb__glass {
  background:
    radial-gradient(circle at 30% 28%, rgba(255,255,255,0.18), rgba(255,255,255,0) 55%),
    linear-gradient(160deg, #334155 0%, #475569 60%, #334155 100%);
}

/* Speaking: aurora at full tilt, halo expands/brightens with the live audio
   level via --lvl (set inline from avgLevel). When --lvl is 0 (browser-TTS
   fallback can't be sampled), a gentle CSS breath keeps things alive. */
.lc-orb--speaking .lc-orb__aurora { opacity: 1; animation-duration: 5.5s; }
.lc-orb--speaking .lc-orb__halo {
  opacity: calc(0.35 + var(--lvl, 0) * 0.55);
  transform: scale(calc(1 + var(--lvl, 0) * 0.10));
  filter: blur(calc(14px + var(--lvl, 0) * 8px));
  transition: opacity 70ms linear, transform 70ms linear, filter 120ms linear;
  animation: lcOrbHaloBreathQuick 2.2s ease-in-out infinite;
}

/* Subtle background breath so the halo never fully flatlines between syllables */
@keyframes lcOrbHaloBreathQuick {
  0%, 100% { box-shadow: 0 0 0 0 rgba(45, 212, 191, 0.0); }
  50%      { box-shadow: 0 0 24px 4px rgba(99, 102, 241, 0.18); }
}
</style>
