<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { useApi } from '../composables/useApi.js'
import {
  ClipboardList, X, Send, TrendingUp, CheckCircle2, Lightbulb, ChevronRight,
} from 'lucide-vue-next'

const props = defineProps({
  goals: { type: Array, required: true },
  month: { type: String, required: true },
})

const emit = defineEmits(['close', 'saved', 'goalsUpdated'])

const { apiFetch, apiStreamPublic } = useApi()

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

// Extract the message value from a partially-streamed JSON blob
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

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(startReview)

// ── Helpers ───────────────────────────────────────────────────────────────────
async function scrollToBottom() {
  await nextTick()
  messagesEl.value?.lastElementChild?.scrollIntoView({ behavior: 'smooth' })
}

// ── Shared streaming helper ───────────────────────────────────────────────────
async function streamReviewTurn(body) {
  loading.value = true
  let accumulated = ''
  let msgIdx = -1

  try {
    for await (const event of apiStreamPublic('/api/reflections/chat', {
      method: 'POST',
      body: JSON.stringify(body),
    })) {
      if (event.error) throw new Error(event.error)

      if (event.delta) {
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
        if (msgIdx !== -1) messages.value[msgIdx].content = event.message
        await scrollToBottom()

        if (event.progressUpdates?.length) {
          await applyProgressUpdates(event.progressUpdates)
        }

        if (event.finished) {
          done.value        = true
          evaluation.value  = event.evaluation
          suggestions.value = event.suggestions
          await saveReflection()
        }
      }
    }
  } finally {
    loading.value = false
  }
}

// ── Review chat ───────────────────────────────────────────────────────────────
async function startReview() {
  error.value = ''
  try {
    await streamReviewTurn({ messages: [], goals: props.goals, month: props.month })
  } catch (e) {
    error.value = e.message
  }
}

async function sendMessage() {
  const text = input.value.trim()
  if (!text || loading.value || done.value) return
  input.value = ''
  messages.value.push({ role: 'user', content: text })
  error.value = ''
  await scrollToBottom()
  const userMsgIdx = messages.value.length - 1
  try {
    await streamReviewTurn({ messages: messages.value, goals: props.goals, month: props.month })
  } catch (e) {
    error.value = e.message
    messages.value.splice(userMsgIdx)
  }
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
}

// ── Progress updates ──────────────────────────────────────────────────────────
async function applyProgressUpdates(updates) {
  const applied = []
  await Promise.allSettled(updates.map(async ({ goalIndex, progress }) => {
    const goal = props.goals[goalIndex - 1]
    if (!goal || typeof progress !== 'number') return
    const clamped = Math.max(0, Math.min(100, Math.round(progress)))
    try {
      await apiFetch(`/api/goals/${goal.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ progress: clamped }),
      })
      applied.push({ title: goal.title, progress: clamped })
    } catch { /* non-critical */ }
  }))

  if (applied.length) {
    messages.value.push({
      role:    'system',
      content: applied.map(u => `${u.title} → ${u.progress}%`).join(' · '),
    })
    emit('goalsUpdated')
    await scrollToBottom()
  }
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
    <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-md" @click="!done && emit('close')" />

    <!-- Modal panel -->
    <div
      class="relative z-10 w-full max-w-2xl flex flex-col rounded-3xl overflow-hidden animate-scale-in"
      style="max-height:90vh; box-shadow: var(--shadow-modal)"
    >

      <!-- ── Gradient header ─────────────────────────────────────────────────── -->
      <div class="shrink-0 relative overflow-hidden px-6 py-5"
           style="background: linear-gradient(135deg, #b45309 0%, #d97706 45%, #f59e0b 100%)">
        <!-- Decorative circles -->
        <div class="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <div class="pointer-events-none absolute -left-6 -bottom-6 h-24 w-24 rounded-full bg-white/8" />
        <div class="pointer-events-none absolute inset-0"
             style="background: radial-gradient(ellipse at 90% 40%, rgba(255,255,255,0.18) 0%, transparent 60%)" />

        <div class="relative flex items-start justify-between">
          <div class="flex items-center gap-3">
            <div class="h-11 w-11 rounded-2xl bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center shadow-lg">
              <ClipboardList class="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 class="text-base font-bold text-white">Monthly Progress Review</h2>
              <p class="text-xs text-amber-100/80">{{ monthLabel }} · {{ goals.length }} {{ goals.length === 1 ? 'goal' : 'goals' }}</p>
            </div>
          </div>
          <button
            v-if="!saving"
            @click="emit('close')"
            class="rounded-xl p-1.5 text-white/60 hover:text-white hover:bg-white/15 transition-all"
          >
            <X class="h-5 w-5" />
          </button>
        </div>

        <!-- Goal chips -->
        <div class="relative flex flex-wrap gap-1.5 mt-4">
          <span
            v-for="goal in goals"
            :key="goal.id"
            class="inline-flex items-center rounded-full bg-white/20 backdrop-blur-sm border border-white/30 px-3 py-1 text-xs font-medium text-white"
          >{{ goal.title }}</span>
        </div>
      </div>

      <!-- ── Body ───────────────────────────────────────────────────────────── -->
      <div class="flex flex-col flex-1 min-h-0 bg-white">

        <!-- Error banner -->
        <p v-if="error" class="mx-6 mt-3 text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-4 py-2 shrink-0">
          {{ error }}
        </p>

        <!-- Chat messages -->
        <div
          ref="messagesEl"
          class="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3 min-h-0"
          style="background: var(--page-bg)"
        >
          <template v-for="(msg, i) in messages" :key="i">

            <!-- System notice: progress updated -->
            <div v-if="msg.role === 'system'" class="flex justify-center">
              <div class="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm">
                <TrendingUp class="h-3.5 w-3.5 shrink-0" />
                Progress updated: {{ msg.content }}
              </div>
            </div>

            <!-- Chat bubble -->
            <div
              v-else
              class="flex animate-fade-up"
              :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
            >
              <!-- AI avatar -->
              <div
                v-if="msg.role === 'assistant'"
                class="mr-2 mt-1 shrink-0 h-7 w-7 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm"
              >
                <ClipboardList class="h-3.5 w-3.5 text-white" />
              </div>

              <div
                class="max-w-[78%] whitespace-pre-wrap"
                :class="msg.role === 'user' ? 'bubble-user' : 'bubble-ai'"
              >{{ msg.content }}</div>
            </div>
          </template>

          <!-- Typing indicator -->
          <div v-if="loading" class="flex justify-start">
            <div class="mr-2 mt-1 shrink-0 h-7 w-7 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm">
              <ClipboardList class="h-3.5 w-3.5 text-white" />
            </div>
            <div class="bubble-ai flex items-center gap-1.5">
              <span class="typing-dot" />
              <span class="typing-dot" />
              <span class="typing-dot" />
            </div>
          </div>

          <!-- Evaluation card -->
          <div
            v-if="done && evaluation"
            class="card mt-2 p-5 animate-fade-up"
            style="background: linear-gradient(135deg, #fffbeb 0%, #fff7ed 100%); border-color: rgba(251,191,36,0.3)"
          >
            <div class="flex items-center gap-2.5 mb-3">
              <div class="h-8 w-8 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm">
                <ClipboardList class="h-4 w-4 text-white" />
              </div>
              <h3 class="text-sm font-bold text-amber-900">Your Progress Evaluation</h3>
              <span v-if="saving" class="ml-auto text-xs text-amber-600 animate-pulse">Saving…</span>
              <span v-else class="ml-auto flex items-center gap-1 text-xs text-emerald-600 font-semibold">
                <CheckCircle2 class="h-3.5 w-3.5" />
                Saved
              </span>
            </div>
            <p class="text-sm text-amber-900 leading-relaxed whitespace-pre-wrap">{{ evaluation }}</p>

            <div v-if="suggestions.length" class="mt-4 pt-4 border-t border-amber-200/50">
              <div class="flex items-center gap-1.5 mb-3">
                <Lightbulb class="h-3.5 w-3.5 text-amber-500" />
                <h4 class="text-xs font-bold text-amber-700 uppercase tracking-wider">Suggestions to keep you on track</h4>
              </div>
              <ul class="flex flex-col gap-2">
                <li
                  v-for="(s, si) in suggestions"
                  :key="si"
                  class="flex items-start gap-2.5 text-sm text-amber-900"
                >
                  <span class="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-amber-200/70 flex items-center justify-center text-xs font-bold text-amber-700">{{ si + 1 }}</span>
                  {{ s }}
                </li>
              </ul>
            </div>
          </div>
        </div>

        <!-- ── Input row ───────────────────────────────────────────────────── -->
        <div v-if="!done" class="px-6 py-4 border-t border-slate-100 shrink-0">
          <div class="flex gap-2.5 items-end">
            <textarea
              v-model="input"
              @keydown="onKeydown"
              rows="2"
              placeholder="Type your answer… (Enter to send)"
              :disabled="loading"
              class="input flex-1 resize-none"
              style="border-radius: 14px; padding: 11px 16px"
            />
            <button
              @click="sendMessage"
              :disabled="loading || !input.trim()"
              class="btn btn-primary disabled:opacity-40"
              style="padding: 11px 13px; border-radius: 14px"
            >
              <Send class="h-5 w-5" />
            </button>
          </div>
          <p class="mt-1.5 text-center text-xs text-slate-400">Press <kbd class="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium text-slate-500">Enter</kbd> to send, <kbd class="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium text-slate-500">Shift+Enter</kbd> for new line</p>
        </div>

        <!-- ── Done footer ─────────────────────────────────────────────────── -->
        <div v-if="done" class="px-6 py-4 border-t border-slate-100 flex items-center justify-between shrink-0">
          <p class="text-sm text-slate-500">Your reflection has been saved.</p>
          <button @click="emit('close')" class="btn btn-primary gap-1.5">
            View Reflections
            <ChevronRight class="h-4 w-4" />
          </button>
        </div>

      </div>
    </div>
  </div>
</template>
