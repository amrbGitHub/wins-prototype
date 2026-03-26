<script setup>
import { ref, onMounted, computed, nextTick } from 'vue'
import { useApi } from '../composables/useApi.js'

const emit = defineEmits(['goToGoals'])
const { apiFetch, apiFetchPublic } = useApi()

// ── State ─────────────────────────────────────────────────────────────────────
const month         = ref(new Date().toISOString().slice(0, 7))
const messages      = ref([])
const input         = ref('')
const loading       = ref(false)
const saving        = ref(false)
const readyToExtract = ref(false)
const started       = ref(false)
const error         = ref('')
const messagesEl    = ref(null)

const monthLabel = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
})

// ── Load existing session ─────────────────────────────────────────────────────
onMounted(async () => {
  try {
    const data = await apiFetch(`/api/planner/${month.value}`)
    if (data?.messages?.length) {
      messages.value    = data.messages
      readyToExtract.value = data.readyToExtract ?? false
      started.value     = true
      await scrollToBottom()
    }
  } catch { /* no session yet */ }
})

// ── Helpers ───────────────────────────────────────────────────────────────────
async function scrollToBottom() {
  await nextTick()
  messagesEl.value?.lastElementChild?.scrollIntoView({ behavior: 'smooth' })
}

async function persistSession() {
  try {
    await apiFetch('/api/planner/session', {
      method: 'POST',
      body: JSON.stringify({ month: month.value, messages: messages.value, readyToExtract: readyToExtract.value }),
    })
  } catch { /* best effort */ }
}

// ── Start planning ────────────────────────────────────────────────────────────
async function startPlanning() {
  started.value = true
  loading.value = true
  error.value   = ''
  try {
    const data = await apiFetchPublic('/api/planner/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [], month: month.value }),
    })
    messages.value       = [{ role: 'assistant', content: data.message }]
    readyToExtract.value = data.readyToExtract ?? false
    await persistSession()
    await scrollToBottom()
  } catch (e) {
    error.value = e.message
    started.value = false
  } finally {
    loading.value = false
  }
}

// ── Send a message ────────────────────────────────────────────────────────────
async function sendMessage() {
  const text = input.value.trim()
  if (!text || loading.value) return
  input.value = ''
  messages.value.push({ role: 'user', content: text })
  loading.value = true
  error.value   = ''
  await scrollToBottom()
  try {
    const data = await apiFetchPublic('/api/planner/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: messages.value, month: month.value }),
    })
    messages.value.push({ role: 'assistant', content: data.message })
    readyToExtract.value = data.readyToExtract ?? false
    await persistSession()
    await scrollToBottom()
  } catch (e) {
    error.value = e.message
    messages.value.pop()
  } finally {
    loading.value = false
  }
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
}

// ── Save goals ────────────────────────────────────────────────────────────────
async function saveGoals() {
  saving.value = true
  error.value  = ''
  try {
    await apiFetch('/api/planner/extract-goals', {
      method: 'POST',
      body: JSON.stringify({ messages: messages.value, month: month.value }),
    })
    emit('goToGoals')
  } catch (e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="mx-auto max-w-3xl px-4 py-8">

    <!-- ── Empty state ──────────────────────────────────────────────────────── -->
    <div v-if="!started" class="flex flex-col items-center justify-center min-h-[62vh] gap-6 text-center">
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
      <button
        @click="startPlanning"
        :disabled="loading"
        class="rounded-2xl bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[#0d5f6b]/25 hover:shadow-xl hover:shadow-[#0d5f6b]/30 transition-all duration-200 hover:-translate-y-0.5 disabled:opacity-60"
      >
        {{ loading ? 'Starting…' : 'Start Planning' }}
      </button>
    </div>

    <!-- ── Chat ─────────────────────────────────────────────────────────────── -->
    <div v-else class="flex flex-col gap-5">

      <!-- Month label -->
      <div class="flex items-center gap-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">
        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
        </svg>
        Planning for {{ monthLabel }}
      </div>

      <!-- Messages -->
      <div ref="messagesEl" class="flex flex-col gap-3">
        <div
          v-for="(msg, i) in messages"
          :key="i"
          class="flex"
          :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <!-- AI avatar -->
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

      <!-- Error -->
      <p v-if="error" class="text-sm text-rose-500 bg-rose-50 border border-rose-100 rounded-xl px-4 py-2.5">{{ error }}</p>

      <!-- Save goals CTA -->
      <div
        v-if="readyToExtract"
        class="rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50/60 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div>
          <p class="text-sm font-semibold text-emerald-800">Ready to save your goals</p>
          <p class="text-xs text-emerald-600 mt-0.5">Your AI coach will turn this conversation into clear monthly goals.</p>
        </div>
        <button
          @click="saveGoals"
          :disabled="saving"
          class="shrink-0 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5 disabled:opacity-60"
        >
          {{ saving ? 'Saving…' : 'Save my goals' }}
        </button>
      </div>

      <!-- Input -->
      <div v-if="!readyToExtract" class="flex gap-2 mt-1">
        <textarea
          v-model="input"
          @keydown="onKeydown"
          rows="2"
          placeholder="Type your response… (Enter to send)"
          :disabled="loading"
          class="flex-1 resize-none rounded-2xl border border-slate-200/70 bg-white px-4 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#0d5f6b]/30 focus:border-[#0d5f6b]/50 disabled:opacity-50 transition placeholder:text-slate-400"
        />
        <button
          @click="sendMessage"
          :disabled="loading || !input.trim()"
          class="self-end rounded-2xl bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] p-3 text-white shadow-md hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5 disabled:opacity-40"
        >
          <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
          </svg>
        </button>
      </div>

    </div>
  </main>
</template>
