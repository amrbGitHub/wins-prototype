<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useApi } from '../composables/useApi.js'
import { useLcChat } from '../composables/useLcChat.js'
import LcActionCard from './LcActionCard.vue'
import {
  Sparkles, Send, Trash2, Plus, RefreshCw, MessageSquare, Mic, X, Download,
  MessagesSquare, PanelLeft, PanelLeftClose, AlertCircle, Eraser,
} from 'lucide-vue-next'

const props = defineProps({ firstName: { type: String, default: '' } })
const emit  = defineEmits(['goals-updated', 'navigate'])

const { apiFetch } = useApi()

// Conversation mode tabs removed — "Plan my month" was a separate system
// prompt for what is effectively the same chat surface, and the L&D-aware
// check-in prompt already handles planning conversations naturally
// ("let's plan my month" works fine without a mode switch).

// ── Input mode ─────────────────────────────────────────────────────────────
const inputMode = ref('voice')

// ── Conversation persistence ───────────────────────────────────────────────
const conversations     = ref([])
const conversationId    = ref(null)
const conversationTitle = ref('New chat')
const sidebarOpen       = ref(true)

// generation token: any in-flight save tagged with an old generation is dropped.
// This prevents the cross-conversation save corruption flagged in review #2.
let _saveGen = 0

// Track how many messages we've already persisted in the current conversation.
// On every turn boundary we POST .../messages with just the new tail, instead
// of overwriting the entire JSONB blob.
let _lastPersistedCount = 0

// ── LC chat composable ─────────────────────────────────────────────────────
const lc = useLcChat({
  getFirstName:      () => props.firstName,
  getConversationId: () => conversationId.value,   // for gateway: link pseudonyms to this convo
  onGoalsUpdated:    () => emit('goals-updated'),
  onNavigate:        (id) => emit('navigate', id),
  onAfterTurn:       () => persistConversationTail(),
})

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
  rehydrateActions, newId,
} = lc

const voiceCapable = computed(() => sttSupported.value && ttsSupported.value)
// Mean of the live audio bins — drives the orb's halo glow during speech.
const avgLevel = computed(() => {
  const arr = ttsLevels.value || []
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
})
// Only Whisper (STT) has a loadable model now — ElevenLabs is server-side
// and the browser TTS fallback is instant.
const voiceModelLoading  = computed(() => sttLoading.value)
const voiceModelProgress = computed(() => sttLoadProgress.value)
const voiceModelLabel    = computed(() => 'Loading speech recognition…')

// ── Text input state ───────────────────────────────────────────────────────
const textInput = ref('')

// ── Lifecycle ──────────────────────────────────────────────────────────────
onMounted(async () => {
  inputMode.value = voiceCapable.value ? 'voice' : 'text'
  await loadConversations()
  if (conversations.value.length) {
    await openConversation(conversations.value[0].id)
  } else {
    await startNewChat()
  }
})
onUnmounted(stopAll)

function switchInputMode(newMode) {
  if (inputMode.value === newMode) return
  stopAll()
  inputMode.value = newMode
}

// ── Conversation persistence ───────────────────────────────────────────────
async function loadConversations() {
  try {
    const list = await apiFetch('/api/lc/conversations')
    conversations.value = Array.isArray(list) ? list : []
  } catch (e) {
    console.error('[LC] load conversations failed:', e)
    conversations.value = []
  }
}

async function startNewChat() {
  // Bump generation BEFORE doing anything else: any in-flight save against the
  // previous conversation will see the stale gen and bail out.
  _saveGen++
  const myGen = _saveGen

  stopAll()
  reset()
  conversationId.value     = null
  conversationTitle.value  = 'New chat'
  _lastPersistedCount = 0

  try {
    const created = await apiFetch('/api/lc/conversations', {
      method: 'POST',
      body: JSON.stringify({
        title: conversationTitle.value,
        messages: [],
      }),
    })
    if (myGen !== _saveGen) return
    conversationId.value = created.id
    await loadConversations()
  } catch (e) {
    console.error('[LC] create conversation failed:', e)
    return
  }

  if (myGen !== _saveGen) return
  if (inputMode.value === 'voice') await runVoiceTurn()
  else                              await runTextGreeting()
}

async function openConversation(id) {
  if (conversationId.value === id) return
  _saveGen++
  const myGen = _saveGen

  stopAll()
  try {
    const full = await apiFetch(`/api/lc/conversations/${id}`)
    if (myGen !== _saveGen) return

    conversationId.value     = full.id
    conversationTitle.value  = full.title || 'Chat'
    // Rehydrate messages — heal any stuck-pending action statuses.
    messages.value = (full.messages || []).map(m => {
      const id = m._id || newId('m')
      if (m.role === 'assistant' && Array.isArray(m.actions)) {
        return { ...m, _id: id, actions: rehydrateActions(m.actions) }
      }
      return { ...m, _id: id }
    })
    _lastPersistedCount = messages.value.length
    lc.scrollBottom()
  } catch (e) {
    console.error('[LC] open conversation failed:', e)
    error.value = 'Could not load that conversation.'
  }
}

async function deleteConversation(id, ev) {
  ev?.stopPropagation()
  if (!confirm('Delete this chat? This cannot be undone.')) return
  try {
    await apiFetch(`/api/lc/conversations/${id}`, { method: 'DELETE' })
    await loadConversations()
    if (conversationId.value === id) {
      if (conversations.value.length) await openConversation(conversations.value[0].id)
      else                            await startNewChat()
    }
  } catch (e) {
    console.error('[LC] delete conversation failed:', e)
  }
}

// Global wipe of the per-user pseudonym registry. After this, the next time
// LC sees "James" it mints a brand-new pseudonym — Claude has zero memory
// of any prior conversations about James (or anyone). Use sparingly; cannot
// be undone. Endpoint mounted only when LC_GATEWAY_ENABLED.
async function clearLcMemory() {
  const confirmed = confirm(
    'Clear LC\'s memory of every person, organization, and place you\'ve mentioned?\n\n' +
    'This drops all pseudonym mappings. Past conversations stay, but LC will no longer recognize anyone from them as the "same person" going forward. Cannot be undone.'
  )
  if (!confirmed) return
  try {
    const { deleted } = await apiFetch('/api/elsie/clear-pseudonyms', { method: 'POST' })
    alert(`Cleared ${deleted} pseudonym${deleted === 1 ? '' : 's'} from LC's memory.`)
  } catch (e) {
    console.error('[LC] clear pseudonyms failed:', e)
    alert('Failed to clear LC memory — check the console.')
  }
}

// Download the full conversation as JSON. Includes message contents, action
// payloads, action result states, and failure annotations — everything needed
// to debug a session without screenshots. Filename slug uses the chat title.
async function downloadConversation(id, ev) {
  ev?.stopPropagation()
  try {
    const full = await apiFetch(`/api/lc/conversations/${id}`)
    const payload = {
      exportedAt: new Date().toISOString(),
      conversation: {
        id:        full.id,
        title:     full.title,
        createdAt: new Date(full.createdAt).toISOString(),
        updatedAt: new Date(full.updatedAt).toISOString(),
        messages:  full.messages || [],
      },
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const slug = String(full.title || 'untitled')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'chat'
    const date = new Date().toISOString().slice(0, 10)
    const a = document.createElement('a')
    a.href = url
    a.download = `lc-chat-${slug}-${date}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (e) {
    alert('Failed to download chat: ' + e.message)
  }
}

// Persist only the NEW messages since last save. Called on turn boundaries
// (onAfterTurn from the composable). Does nothing if no new messages.
async function persistConversationTail() {
  if (!conversationId.value) return
  const all  = messages.value
  if (all.length <= _lastPersistedCount) return
  const tail = all.slice(_lastPersistedCount)
  // Snapshot the conversation+gen we're saving against — drop the result if
  // the user has switched chats by the time the response comes back.
  const targetId = conversationId.value
  const myGen    = _saveGen
  // Strip reactive proxies / non-persistable internals
  const sanitised = JSON.parse(JSON.stringify(tail))
  try {
    await apiFetch(`/api/lc/conversations/${targetId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ messages: sanitised }),
    })
    if (myGen !== _saveGen || conversationId.value !== targetId) return  // user switched chats; the data still landed on the right row but don't update local bookkeeping
    _lastPersistedCount = all.length

    // Auto-title: once we have a real exchange (≥1 user msg + ≥1 assistant
    // reply) AND the title is still the default placeholder, ask LC to
    // generate a short topic-paraphrase. Fire-and-forget; non-blocking.
    const userCount      = all.filter(m => m.role === 'user').length
    const assistantCount = all.filter(m => m.role === 'assistant').length
    const titleIsDefault = ['New chat', 'Chat', ''].includes(conversationTitle.value || '')
    if (titleIsDefault && userCount >= 1 && assistantCount >= 1) {
      generateAutoTitle(targetId, myGen)   // intentionally not awaited
    }

    // Refresh sidebar list (don't await — non-critical)
    loadConversations()
  } catch (e) {
    console.error('[LC] persist failed:', e)
  }
}

// Background call to /auto-title. Runs once per conversation, guarded by
// the save generation so a switched chat doesn't clobber the new title.
let _autoTitleInFlight = false
async function generateAutoTitle(targetId, myGen) {
  if (_autoTitleInFlight) return
  _autoTitleInFlight = true
  try {
    const updated = await apiFetch(`/api/lc/conversations/${targetId}/auto-title`, {
      method: 'POST',
    })
    if (myGen !== _saveGen || conversationId.value !== targetId) return
    if (updated?.title) {
      conversationTitle.value = updated.title
      loadConversations()   // refresh sidebar to show the new title
    }
  } catch (e) {
    // Non-fatal — title stays as the default. Just log.
    console.warn('[LC] auto-title failed:', e?.message || e)
  } finally {
    _autoTitleInFlight = false
  }
}

// ── Text input ─────────────────────────────────────────────────────────────
async function sendText() {
  const t = textInput.value
  textInput.value = ''
  await sendTextMessage(t)
}

function onTextEnter(e) {
  if (e.isComposing || e.keyCode === 229) return   // IME composition
  if (e.shiftKey) return
  e.preventDefault()
  sendText()
}

function relTime(ts) {
  const d = Date.now() - ts
  if (d < 60_000)      return 'just now'
  if (d < 3_600_000)   return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000)  return `${Math.floor(d / 3_600_000)}h ago`
  if (d < 604_800_000) return `${Math.floor(d / 86_400_000)}d ago`
  return new Date(ts).toLocaleDateString()
}
</script>

<template>
  <div class="min-h-screen flex" style="background:var(--page-bg)">

    <!-- ── Sidebar ─────────────────────────────────────────────────────────── -->
    <aside
      class="shrink-0 border-r flex flex-col transition-all duration-200 overflow-hidden"
      :class="sidebarOpen ? 'w-72' : 'w-0'"
      style="background:#fff;border-color:rgba(0,0,0,0.06)"
      aria-label="Past conversations"
    >
      <div class="px-4 py-4 border-b flex items-center justify-between" style="border-color:rgba(0,0,0,0.06)">
        <div class="flex items-center gap-2">
          <MessagesSquare class="h-4 w-4 text-slate-500" aria-hidden="true" />
          <h2 class="text-sm font-bold text-slate-700">Chats</h2>
        </div>
        <button @click="startNewChat"
          :disabled="streaming || convoStatus === 'processing'"
          class="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-white shadow-sm disabled:opacity-40"
          style="background:linear-gradient(135deg,#0d5f6b,#0e8095)" aria-label="Start a new chat">
          <Plus class="h-3 w-3" aria-hidden="true" /> New
        </button>
      </div>

      <div class="flex-1 overflow-y-auto px-2 py-2">
        <p v-if="!conversations.length" class="px-3 py-6 text-center text-xs text-slate-400">
          No chats yet — start talking to LC and it will save here.
        </p>
        <button v-for="c in conversations" :key="c.id"
          @click="openConversation(c.id)"
          class="group w-full text-left rounded-lg px-3 py-2 mb-1 transition flex items-start gap-2"
          :class="conversationId === c.id ? 'bg-teal-50 ring-1 ring-teal-200' : 'hover:bg-slate-50'"
          :aria-current="conversationId === c.id ? 'true' : 'false'">
          <div class="shrink-0 mt-0.5" aria-hidden="true">
            <Sparkles class="h-3.5 w-3.5 text-teal-500" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-[12px] font-semibold text-slate-700 truncate">{{ c.title || 'New chat' }}</p>
            <p class="text-[10px] text-slate-400 mt-0.5">
              {{ relTime(c.updatedAt) }}
            </p>
          </div>
          <div class="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
            <button @click="downloadConversation(c.id, $event)"
              class="text-slate-400 hover:text-cyan-600"
              aria-label="Download chat as JSON">
              <Download class="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button @click="deleteConversation(c.id, $event)"
              class="text-slate-400 hover:text-rose-500"
              aria-label="Delete chat">
              <Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </button>
      </div>

      <!-- Settings footer: privacy controls. Wipes the per-user pseudonym
           registry. Use when starting fresh or after a sensitive conversation
           where memory continuity isn't worth the privacy artifact. -->
      <div class="border-t px-3 py-3" style="border-color:rgba(0,0,0,0.06)">
        <button @click="clearLcMemory"
          class="w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[11px] font-semibold text-slate-600 hover:text-rose-600 hover:bg-rose-50 transition"
          aria-label="Clear LC's memory of all people, orgs, and places">
          <Eraser class="h-3.5 w-3.5" aria-hidden="true" />
          Clear LC memory
        </button>
      </div>
    </aside>

    <!-- ── Main column ─────────────────────────────────────────────────────── -->
    <div class="flex-1 flex flex-col min-w-0">

      <div class="relative overflow-hidden shrink-0"
           style="background:linear-gradient(135deg,#0b1a1c 0%,#0d5f6b 55%,#0e8095 100%)">
        <div class="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/5 blur-3xl"></div>
        <div class="pointer-events-none absolute -bottom-8 left-1/4 h-40 w-40 rounded-full bg-cyan-300/10 blur-2xl"></div>

        <div class="relative mx-auto max-w-3xl px-6 py-6">
          <div class="flex items-center justify-between gap-4 flex-wrap">

            <div class="flex items-center gap-3">
              <button @click="sidebarOpen = !sidebarOpen"
                class="flex h-9 w-9 items-center justify-center rounded-xl ring-1 ring-white/20 text-white/70 hover:text-white hover:bg-white/15 transition"
                style="background:rgba(255,255,255,0.08)"
                :aria-label="sidebarOpen ? 'Hide chat list' : 'Show chat list'"
                :aria-expanded="sidebarOpen">
                <component :is="sidebarOpen ? PanelLeftClose : PanelLeft" class="h-4 w-4" aria-hidden="true" />
              </button>

              <div class="relative shrink-0" aria-hidden="true">
                <div class="h-12 w-12 rounded-2xl flex items-center justify-center shadow-lg ring-1 ring-white/20"
                     style="background:rgba(255,255,255,0.12);backdrop-filter:blur(8px)">
                  <Sparkles class="h-6 w-6 text-teal-300" />
                </div>
                <span class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 bg-emerald-400" style="border-color:#0b1a1c"></span>
              </div>
              <div class="min-w-0">
                <h1 class="text-xl font-extrabold tracking-tight text-white leading-tight">LC</h1>
                <p class="text-[11px] text-teal-200/70 mt-0.5 truncate max-w-[200px]">{{ conversationTitle }}</p>
              </div>
            </div>

            <div class="flex items-center gap-2 flex-wrap">
              <div class="flex overflow-hidden rounded-lg ring-1 ring-white/15 bg-white/10 p-0.5" role="tablist" aria-label="Input mode">
                <button @click="switchInputMode('voice')" :disabled="!voiceCapable" role="tab" :aria-selected="inputMode === 'voice'"
                  class="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all disabled:opacity-40"
                  :class="inputMode === 'voice' ? 'bg-white text-slate-700 shadow-sm' : 'text-white/70 hover:text-white'"
                ><Mic class="h-3 w-3" aria-hidden="true" />Voice</button>
                <button @click="switchInputMode('text')" role="tab" :aria-selected="inputMode === 'text'"
                  class="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all"
                  :class="inputMode === 'text' ? 'bg-white text-slate-700 shadow-sm' : 'text-white/70 hover:text-white'"
                ><MessageSquare class="h-3 w-3" aria-hidden="true" />Text</button>
              </div>

              <button @click="startNewChat" :disabled="convoStatus === 'processing' || streaming"
                aria-label="New chat"
                class="flex h-9 w-9 items-center justify-center rounded-xl ring-1 ring-white/20 text-white/70 hover:text-white hover:bg-white/15 transition disabled:opacity-40"
                style="background:rgba(255,255,255,0.08)">
                <RefreshCw class="h-4 w-4" :class="(convoStatus === 'processing' || streaming) ? 'animate-spin' : ''" aria-hidden="true" />
              </button>
            </div>
          </div>

          <p class="mt-2.5 text-[11px] text-teal-200/55">
            Tell me about your wins, your sessions, what's going on with a learner or program — I'll log, update, and think through it with you.
          </p>
        </div>
      </div>

      <!-- VOICE MODE -->
      <template v-if="inputMode === 'voice'">
        <div class="flex-1 flex flex-col items-center justify-center px-6 py-10 gap-7 mx-auto w-full max-w-lg">

          <Transition enter-active-class="transition duration-300 ease-out"
            enter-from-class="opacity-0 translate-y-3" enter-to-class="opacity-100 translate-y-0">
            <div v-if="lastAiMsg" class="w-full rounded-2xl border border-slate-100 bg-white px-6 py-4 text-center text-sm leading-relaxed text-slate-700 shadow-sm">
              {{ lastAiMsg }}
            </div>
          </Transition>

          <div v-if="voiceModelLoading" class="flex flex-col items-center gap-3">
            <div class="relative h-32 w-32" role="progressbar" :aria-valuenow="voiceModelProgress" aria-valuemin="0" aria-valuemax="100" :aria-label="voiceModelLabel">
              <svg class="h-32 w-32 -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="40" fill="none" stroke="#e2e8f0" stroke-width="6" />
                <circle cx="50" cy="50" r="40" fill="none" stroke="#0d5f6b" stroke-width="6" stroke-linecap="round"
                  :stroke-dasharray="`${2 * Math.PI * 40}`"
                  :stroke-dashoffset="`${2 * Math.PI * 40 * (1 - voiceModelProgress / 100)}`"
                  class="transition-all duration-300" />
              </svg>
              <span class="absolute inset-0 flex items-center justify-center text-sm font-bold text-[#0d5f6b]">{{ voiceModelProgress }}%</span>
            </div>
            <p class="text-sm font-semibold text-slate-600">{{ voiceModelLabel }}</p>
            <p v-if="sttLoading" class="text-[11px] text-slate-400 max-w-[240px] text-center">
              One-time download (~75MB). Cached for future sessions.
            </p>
          </div>

          <button v-else @click="toggleConvoMic" :disabled="convoStatus === 'processing'"
            :aria-label="convoStatus === 'listening' ? 'Stop listening' : (convoStatus === 'speaking' ? 'Interrupt and speak' : 'Tap to speak')"
            class="lc-orb relative h-40 w-40 rounded-full transition-transform duration-200 focus:outline-none hover:scale-105 active:scale-95 disabled:cursor-default disabled:hover:scale-100"
            :class="{
              'lc-orb--listening':  convoStatus === 'listening',
              'lc-orb--speaking':   convoStatus === 'speaking',
              'lc-orb--processing': convoStatus === 'processing',
              'lc-orb--idle':       convoStatus === 'idle',
            }"
            :style="`--lvl:${avgLevel}`">
            <span class="lc-orb__halo absolute -inset-4 rounded-full pointer-events-none" />
            <span class="lc-orb__aurora absolute inset-0 rounded-full overflow-hidden" />
            <span class="lc-orb__glass absolute inset-2 rounded-full" />
            <span class="absolute inset-0 flex items-center justify-center z-10" aria-hidden="true">
              <svg v-if="convoStatus === 'idle' || convoStatus === 'listening'"
                class="h-14 w-14 transition-colors duration-300"
                :class="convoStatus === 'listening' ? 'text-white' : 'text-slate-400'"
                viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z"/>
              </svg>
              <!-- Live audio visualizer — see Elsie.vue for the design note. -->
              <span v-else-if="convoStatus === 'speaking'" class="flex h-11 items-end gap-1.5">
                <span v-for="(lvl, i) in ttsLevels" :key="i"
                  class="w-2 rounded-full bg-white transition-all duration-75 ease-out"
                  :class="{ 'animate-bounce': lvl === 0 }"
                  :style="lvl > 0
                    ? `height:${15 + lvl * 85}%`
                    : `height:${[35,75,55,95,45][i]}%;animation-delay:${[0,90,180,60,150][i]}ms`" />
              </span>
              <svg v-else class="h-11 w-11 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            </span>
          </button>

          <div class="flex flex-col items-center gap-2.5 min-h-[80px] w-full" aria-live="polite">
            <p class="text-sm font-semibold text-slate-500 h-5">{{ convoStatusLabel }}</p>
            <!-- Live transcription. Native SR fills as the user speaks; Whisper
                 fills it after the user taps to stop. Persists through
                 processing + speaking so the user can confirm what was captured. -->
            <p v-if="convoTranscript" class="w-full max-w-md text-center text-base leading-snug text-slate-700 font-medium px-4 py-2 rounded-xl bg-slate-50 border border-slate-100">
              {{ convoTranscript }}
            </p>
            <p v-else-if="convoStatus === 'idle' && lastAiMsg" class="text-xs text-slate-400 text-center">
              Tap to start speaking
            </p>
          </div>

          <!-- Hard-cancel button — visible whenever voice is doing something.
               One-click escape hatch: aborts STT, kills any in-flight LLM
               request, stops TTS, returns straight to idle. -->
          <button
            v-if="convoStatus !== 'idle'"
            @click="cancelVoiceTurn"
            class="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm hover:bg-slate-50 hover:border-slate-400 transition"
            aria-label="Cancel current voice turn"
          >
            <X class="h-4 w-4" aria-hidden="true" />
            Stop
          </button>

          <div v-if="lastActions.length && convoStatus !== 'listening'" class="w-full flex flex-col gap-2">
            <LcActionCard v-for="(action, ai) in lastActions" :key="action._id"
              :action="action" density="roomy"
              @navigate="clickNavigateAction(messages.length - 1, ai)" />
          </div>

          <div v-if="error" class="flex items-center gap-2 max-w-sm rounded-xl bg-rose-50 border border-rose-100 px-4 py-3">
            <AlertCircle class="h-4 w-4 text-rose-500 shrink-0" aria-hidden="true" />
            <span class="text-sm text-rose-600 flex-1">{{ error }}</span>
            <button v-if="messages.length" @click="retryFromMessage(messages.length - 1)"
              class="inline-flex items-center gap-1 rounded-lg bg-white border border-rose-200 px-2.5 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100 transition">
              <RefreshCw class="h-3 w-3" aria-hidden="true" />Retry
            </button>
          </div>
        </div>
      </template>

      <!-- TEXT MODE -->
      <template v-else>
        <div ref="chatEl" class="flex-1 overflow-y-auto">
          <div class="mx-auto max-w-2xl px-4 py-6 flex flex-col gap-4">
            <p v-if="error" class="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{{ error }}</p>

            <div v-for="(msg, msgIdx) in messages" :key="msg._id">
              <div v-if="msg.role === 'assistant'" class="flex items-start gap-3">
                <div class="shrink-0 h-8 w-8 rounded-xl flex items-center justify-center shadow-sm mt-0.5"
                     style="background:linear-gradient(135deg,#0d5f6b,#0e8095)" aria-hidden="true">
                  <Sparkles class="h-4 w-4 text-white" />
                </div>
                <div class="flex flex-col gap-2 flex-1 min-w-0">
                  <div v-if="streaming && msgIdx === messages.length - 1 && !msg.content"
                       class="bubble-ai inline-flex items-center gap-2 w-fit text-xs">
                    <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
                    <span class="text-slate-500 italic transition-opacity duration-300">{{ thinkingVerb }}</span>
                  </div>
                  <div v-else-if="msg.content" class="bubble-ai whitespace-pre-wrap text-sm">{{ msg.content }}</div>

                  <div v-if="msg.failed && !(streaming && msgIdx === messages.length - 1)"
                       class="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs w-fit">
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
                <div class="bubble-user max-w-[75%] text-sm">{{ msg.content }}</div>
              </div>
            </div>
            <div class="h-2"></div>
          </div>
        </div>

        <div class="shrink-0 px-4 py-4 border-t" style="border-color:rgba(0,0,0,0.06);background:white">
          <div class="mx-auto max-w-2xl flex items-end gap-3">
            <label class="sr-only" for="lc-page-input">Type your message to LC</label>
            <textarea id="lc-page-input" v-model="textInput" @keydown.enter="onTextEnter"
              placeholder="Tell LC how things are going…"
              rows="1" :disabled="streaming"
              class="input flex-1 resize-none leading-relaxed disabled:opacity-50 text-sm"
              style="min-height:44px;max-height:140px;overflow-y:auto" />
            <button @click="sendText" :disabled="!textInput.trim() || streaming"
              aria-label="Send message"
              class="btn btn-primary shrink-0 disabled:opacity-40" style="padding:10px 16px">
              <Send class="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </template>

    </div>
  </div>
</template>

<style scoped>
/* ── LC voice orb ──────────────────────────────────────────────────────────
   See Elsie.vue for the design note. This is the same recipe at the
   full-page size — slightly bigger halo offset and stronger inner shadow
   so it reads as a substantial centerpiece on the conversation page.
   ────────────────────────────────────────────────────────────────────── */

.lc-orb__halo,
.lc-orb__aurora,
.lc-orb__glass {
  transition: opacity 350ms ease, background 400ms ease, box-shadow 400ms ease;
}
.lc-orb__halo   { z-index: 0; }
.lc-orb__aurora { z-index: 1; }
.lc-orb__glass  { z-index: 2; }

.lc-orb__halo {
  background: conic-gradient(
    from 0deg,
    rgba(45, 212, 191, 0.55),
    rgba(99, 102, 241, 0.55),
    rgba(217, 70, 239, 0.55),
    rgba(45, 212, 191, 0.55)
  );
  filter: blur(20px);
  opacity: 0;
  transform: scale(0.96);
}

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

.lc-orb__glass {
  background:
    radial-gradient(circle at 30% 28%, rgba(255,255,255,0.34), rgba(255,255,255,0) 55%),
    linear-gradient(160deg, #0f172a 0%, #1e293b 60%, #0b1220 100%);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.10),
    inset 0 -14px 32px rgba(0,0,0,0.50),
    0 10px 30px rgba(2, 6, 23, 0.40);
}

/* Idle */
.lc-orb--idle .lc-orb__aurora { opacity: 0.25; animation-duration: 22s; }
.lc-orb--idle .lc-orb__halo   { opacity: 0; }
.lc-orb--idle .lc-orb__glass {
  background:
    radial-gradient(circle at 30% 28%, rgba(255,255,255,0.22), rgba(255,255,255,0) 55%),
    linear-gradient(160deg, #1e293b 0%, #334155 60%, #1e293b 100%);
}

/* Listening */
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

/* Processing */
.lc-orb--processing .lc-orb__aurora { opacity: 0.35; animation-play-state: paused; }
.lc-orb--processing .lc-orb__halo   { opacity: 0.18; }
.lc-orb--processing .lc-orb__glass {
  background:
    radial-gradient(circle at 30% 28%, rgba(255,255,255,0.18), rgba(255,255,255,0) 55%),
    linear-gradient(160deg, #334155 0%, #475569 60%, #334155 100%);
}

/* Speaking */
.lc-orb--speaking .lc-orb__aurora { opacity: 1; animation-duration: 5.5s; }
.lc-orb--speaking .lc-orb__halo {
  opacity: calc(0.35 + var(--lvl, 0) * 0.55);
  transform: scale(calc(1 + var(--lvl, 0) * 0.10));
  filter: blur(calc(20px + var(--lvl, 0) * 10px));
  transition: opacity 70ms linear, transform 70ms linear, filter 120ms linear;
  animation: lcOrbHaloBreathQuick 2.2s ease-in-out infinite;
}

@keyframes lcOrbHaloBreathQuick {
  0%, 100% { box-shadow: 0 0 0 0 rgba(45, 212, 191, 0.0); }
  50%      { box-shadow: 0 0 36px 6px rgba(99, 102, 241, 0.20); }
}
</style>
