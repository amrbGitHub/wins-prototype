<script setup>
import { ref, onMounted, computed, nextTick } from 'vue'
import { useApi } from '../composables/useApi.js'

const emit = defineEmits(['goToGoals'])
const { apiFetch, apiFetchPublic } = useApi()

// ── State ─────────────────────────────────────────────────────────────────────
const month      = ref(new Date().toISOString().slice(0, 7))
const messages   = ref([])
const input      = ref('')
const loading    = ref(false)
const deleting   = ref(false)
const goalCount  = ref(0)
const started    = ref(false)
const error      = ref('')
const messagesEl = ref(null)

const monthLabel = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
})

// ── Load existing session on mount ────────────────────────────────────────────
onMounted(async () => {
  try {
    const [sessionData, goalsData] = await Promise.all([
      apiFetch(`/api/planner/${month.value}`),
      apiFetch(`/api/goals?month=${month.value}`).catch(() => []),
    ])
    if (sessionData?.messages?.length) {
      messages.value = sessionData.messages
      goalCount.value = goalsData?.length ?? 0
      started.value = true
      await scrollToBottom()
    }
  } catch { /* no session yet */ }
})

// ── Helpers ───────────────────────────────────────────────────────────────────
async function scrollToBottom() {
  await nextTick()
  messagesEl.value?.lastElementChild?.scrollIntoView({ behavior: 'smooth' })
}

// Fire-and-forget — persists messages + latest goals without blocking the UI
function persistSession(goals) {
  apiFetch('/api/planner/session', {
    method: 'POST',
    body: JSON.stringify({ month: month.value, messages: messages.value, goals }),
  }).catch(() => {})
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
    messages.value  = [{ role: 'assistant', content: data.message }]
    goalCount.value = data.goals?.length ?? 0
    persistSession(data.goals)
    await scrollToBottom()
  } catch (e) {
    error.value   = e.message
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

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
}

// ── Delete plan ───────────────────────────────────────────────────────────────
async function deletePlan() {
  if (!confirm(`Delete your ${monthLabel.value} plan and all goals? This cannot be undone.`)) return
  deleting.value = true
  error.value    = ''
  try {
    await apiFetch(`/api/planner/${month.value}`, { method: 'DELETE' })
    messages.value  = []
    goalCount.value = 0
    started.value   = false
  } catch (e) {
    error.value = e.message
  } finally {
    deleting.value = false
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

      <!-- Toolbar: month label + goals pill + delete -->
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
          </svg>
          Planning for {{ monthLabel }}
        </div>

        <div class="flex items-center gap-2">
          <!-- Live goals pill -->
          <button
            v-if="goalCount > 0"
            @click="emit('goToGoals')"
            class="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition"
          >
            <span class="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {{ goalCount }} {{ goalCount === 1 ? 'goal' : 'goals' }} tracked
            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <!-- Delete plan -->
          <button
            @click="deletePlan"
            :disabled="deleting"
            class="rounded-xl border border-slate-200/70 bg-white p-1.5 text-slate-400 hover:text-rose-500 hover:border-rose-200 hover:bg-rose-50 transition disabled:opacity-40"
            title="Delete plan and all goals for this month"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Messages -->
      <div ref="messagesEl" class="flex flex-col gap-3">
        <div
          v-for="(msg, i) in messages"
          :key="i"
          class="flex"
          :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
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

      <!-- Error -->
      <p v-if="error" class="text-sm text-rose-500 bg-rose-50 border border-rose-100 rounded-xl px-4 py-2.5">{{ error }}</p>

      <!-- Input — always visible -->
      <div class="flex gap-2 mt-1">
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
