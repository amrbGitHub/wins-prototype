<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { useApi } from '../composables/useApi.js'

const props = defineProps({
  goals: { type: Array, required: true },
  month: { type: String, required: true },
})

const emit = defineEmits(['close', 'saved'])

const { apiFetch, apiFetchPublic } = useApi()

// ── State ─────────────────────────────────────────────────────────────────────
const messages    = ref([])
const input       = ref('')
const loading     = ref(false)
const saving      = ref(false)
const done        = ref(false)
const evaluation  = ref('')
const suggestions = ref([])
const messagesEl  = ref(null)
const error       = ref('')

const monthLabel = (() => {
  const [y, m] = props.month.split('-').map(Number)
  return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
})()

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(startReview)

// ── Helpers ───────────────────────────────────────────────────────────────────
async function scrollToBottom() {
  await nextTick()
  messagesEl.value?.lastElementChild?.scrollIntoView({ behavior: 'smooth' })
}

// ── Review chat ───────────────────────────────────────────────────────────────
async function startReview() {
  loading.value = true
  error.value   = ''
  try {
    const data = await apiFetchPublic('/api/reflections/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [], goals: props.goals, month: props.month }),
    })
    messages.value = [{ role: 'assistant', content: data.message }]
    await scrollToBottom()
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function sendMessage() {
  const text = input.value.trim()
  if (!text || loading.value || done.value) return
  input.value = ''
  messages.value.push({ role: 'user', content: text })
  loading.value = true
  error.value   = ''
  await scrollToBottom()
  try {
    const data = await apiFetchPublic('/api/reflections/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: messages.value, goals: props.goals, month: props.month }),
    })
    messages.value.push({ role: 'assistant', content: data.message })
    await scrollToBottom()

    if (data.done) {
      done.value        = true
      evaluation.value  = data.evaluation
      suggestions.value = data.suggestions
      await saveReflection()
    }
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

// ── Save ──────────────────────────────────────────────────────────────────────
async function saveReflection() {
  saving.value = true
  try {
    const reflection = await apiFetch('/api/reflections', {
      method: 'POST',
      body: JSON.stringify({
        month:         props.month,
        goalsSnapshot: props.goals,
        conversation:  messages.value,
        evaluation:    evaluation.value,
        suggestions:   suggestions.value,
      }),
    })
    emit('saved', reflection)
  } catch (e) {
    error.value = 'Saved locally but could not persist: ' + e.message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <!-- Backdrop -->
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="!done && emit('close')">
    <div class="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" @click="!done && emit('close')" />

    <!-- Modal panel -->
    <div class="relative z-10 w-full max-w-2xl flex flex-col bg-white rounded-3xl shadow-2xl overflow-hidden" style="max-height: 90vh">

      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
        <div class="flex items-center gap-3">
          <div class="h-9 w-9 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm">
            <svg class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 class="text-base font-bold text-slate-800">Weekly Progress Review</h2>
            <p class="text-xs text-slate-500">{{ monthLabel }} · {{ goals.length }} {{ goals.length === 1 ? 'goal' : 'goals' }}</p>
          </div>
        </div>
        <button
          v-if="!saving"
          @click="emit('close')"
          class="rounded-xl p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
        >
          <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Goals being reviewed -->
      <div class="px-6 py-2.5 bg-slate-50/80 border-b border-slate-100 flex flex-wrap gap-1.5 shrink-0">
        <span
          v-for="goal in goals"
          :key="goal.id"
          class="rounded-full bg-white border border-slate-200/80 px-2.5 py-0.5 text-xs font-medium text-slate-600 shadow-sm"
        >{{ goal.title }}</span>
      </div>

      <!-- Error -->
      <p v-if="error" class="mx-6 mt-3 text-sm text-rose-500 bg-rose-50 border border-rose-100 rounded-xl px-4 py-2 shrink-0">{{ error }}</p>

      <!-- Chat messages -->
      <div ref="messagesEl" class="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3 min-h-0">
        <div
          v-for="(msg, i) in messages"
          :key="i"
          class="flex"
          :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <div v-if="msg.role === 'assistant'" class="mr-2 mt-1 h-7 w-7 shrink-0 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm">
            <svg class="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div
            class="max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap"
            :class="msg.role === 'user'
              ? 'bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] text-white rounded-br-sm shadow-md'
              : 'bg-white border border-slate-200/70 text-slate-700 rounded-bl-sm shadow-sm'"
          >{{ msg.content }}</div>
        </div>

        <!-- Typing indicator -->
        <div v-if="loading" class="flex justify-start">
          <div class="mr-2 mt-1 h-7 w-7 shrink-0 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm">
            <svg class="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div class="bg-white border border-slate-200/70 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm flex gap-1.5 items-center">
            <span class="h-2 w-2 rounded-full bg-slate-300 animate-bounce" style="animation-delay:0ms" />
            <span class="h-2 w-2 rounded-full bg-slate-300 animate-bounce" style="animation-delay:160ms" />
            <span class="h-2 w-2 rounded-full bg-slate-300 animate-bounce" style="animation-delay:320ms" />
          </div>
        </div>

        <!-- Evaluation card (shown when done) -->
        <div v-if="done && evaluation" class="mt-2 rounded-2xl border border-amber-200/60 bg-gradient-to-br from-amber-50 to-orange-50/40 p-5 shadow-sm">
          <div class="flex items-center gap-2 mb-3">
            <svg class="h-5 w-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
            </svg>
            <h3 class="text-sm font-bold text-amber-800">Your Progress Evaluation</h3>
            <span v-if="saving" class="ml-auto text-xs text-amber-600 animate-pulse">Saving…</span>
            <span v-else class="ml-auto flex items-center gap-1 text-xs text-emerald-600 font-semibold">
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Saved
            </span>
          </div>
          <p class="text-sm text-amber-900 leading-relaxed whitespace-pre-wrap">{{ evaluation }}</p>

          <div v-if="suggestions.length" class="mt-4 pt-4 border-t border-amber-200/60">
            <h4 class="text-xs font-bold text-amber-700 uppercase tracking-wider mb-2.5">Suggestions to keep you on track</h4>
            <ul class="flex flex-col gap-1.5">
              <li
                v-for="(s, i) in suggestions"
                :key="i"
                class="flex items-start gap-2 text-sm text-amber-800"
              >
                <span class="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-amber-200/60 flex items-center justify-center text-xs font-bold text-amber-700">{{ i + 1 }}</span>
                {{ s }}
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Input row (hidden when done) -->
      <div v-if="!done" class="px-6 py-4 border-t border-slate-100 shrink-0">
        <div class="flex gap-2 items-end">
          <textarea
            v-model="input"
            @keydown="onKeydown"
            rows="2"
            placeholder="Type your answer… (Enter to send)"
            :disabled="loading"
            class="flex-1 resize-none rounded-2xl border border-slate-200/70 bg-slate-50 px-4 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400/60 disabled:opacity-50 placeholder:text-slate-400"
          />
          <button
            @click="sendMessage"
            :disabled="loading || !input.trim()"
            class="rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 p-3 text-white shadow-md hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5 disabled:opacity-40"
          >
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Done footer -->
      <div v-if="done" class="px-6 py-4 border-t border-slate-100 flex justify-end shrink-0">
        <button
          @click="emit('close')"
          class="rounded-2xl bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] px-6 py-2.5 text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5"
        >
          View Reflections →
        </button>
      </div>

    </div>
  </div>
</template>
