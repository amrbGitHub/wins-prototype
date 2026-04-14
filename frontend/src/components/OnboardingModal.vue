<script setup>
import { ref, computed } from 'vue'
import { useApi } from '../composables/useApi.js'

const emit = defineEmits(['done'])

const { apiFetch } = useApi()

// ── State ─────────────────────────────────────────────────────────────────────
const step    = ref(1)
const saving  = ref(false)
const error   = ref('')

const form = ref({
  firstName:    '',
  lastName:     '',
  username:     '',
  learningStyle: '',
  aiPersonality: '',
})

// ── Learning style options ────────────────────────────────────────────────────
const learningStyles = [
  { value: 'visual',       label: 'Visual',         desc: 'I learn best through images, diagrams, and seeing information laid out.' },
  { value: 'auditory',     label: 'Auditory',        desc: 'I learn best by listening, talking through ideas, and verbal explanation.' },
  { value: 'reading',      label: 'Reading / Writing', desc: 'I learn best through reading and writing notes.' },
  { value: 'kinesthetic',  label: 'Hands-on',        desc: 'I learn best by doing, practising, and working through real examples.' },
]

// ── AI personality options ────────────────────────────────────────────────────
const personalities = [
  { value: 'warm',    label: 'Warm & Encouraging', desc: 'Uplifting, empathetic, and celebratory — feels like a supportive friend.' },
  { value: 'direct',  label: 'Direct & Concise',   desc: 'Clear, efficient, and to the point — no filler, just what you need.' },
  { value: 'neutral', label: 'Balanced',            desc: 'A natural mix — friendly but professional, encouraging but practical.' },
]

// ── Validation ────────────────────────────────────────────────────────────────
const step1Valid = computed(() => form.value.firstName.trim().length > 0)
const step2Valid = computed(() => form.value.learningStyle !== '')
const step3Valid = computed(() => form.value.aiPersonality !== '')

function next() {
  if (step.value === 1 && !step1Valid.value) return
  if (step.value === 2 && !step2Valid.value) return
  step.value++
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function save() {
  if (!step3Valid.value) return
  saving.value = true
  error.value  = ''
  try {
    const profile = await apiFetch('/api/profile', {
      method: 'POST',
      body: JSON.stringify(form.value),
    })
    emit('done', profile)
  } catch (e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <!-- Backdrop -->
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />

    <!-- Modal -->
    <div class="relative z-10 w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden">

      <!-- Progress bar -->
      <div class="h-1 bg-slate-100">
        <div
          class="h-1 bg-gradient-to-r from-[#0d5f6b] to-teal-400 transition-all duration-500"
          :style="{ width: `${(step / 3) * 100}%` }"
        />
      </div>

      <!-- Header -->
      <div class="px-8 pt-8 pb-4">
        <div class="flex items-center gap-3 mb-1">
          <div class="h-10 w-10 rounded-2xl bg-gradient-to-br from-[#0d5f6b] to-[#0a4a54] flex items-center justify-center shadow-sm">
            <span class="text-lg font-bold text-white">W</span>
          </div>
          <span class="text-xs font-bold text-slate-400 uppercase tracking-widest">Step {{ step }} of 3</span>
        </div>
      </div>

      <!-- ── STEP 1: Basic info ────────────────────────────────────────────── -->
      <div v-if="step === 1" class="px-8 pb-8">
        <h2 class="text-xl font-bold text-slate-800 mb-1">Welcome! Let's set up your profile.</h2>
        <p class="text-sm text-slate-500 mb-6">This helps personalise your experience and lets the AI greet you by name.</p>

        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs font-bold text-slate-500 uppercase tracking-wider">First name <span class="text-rose-400">*</span></label>
              <input
                v-model="form.firstName"
                type="text"
                placeholder="Alex"
                class="mt-1.5 w-full rounded-2xl border border-slate-200/70 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d5f6b]/30 focus:border-[#0d5f6b]/50"
              />
            </div>
            <div>
              <label class="text-xs font-bold text-slate-500 uppercase tracking-wider">Last name</label>
              <input
                v-model="form.lastName"
                type="text"
                placeholder="Johnson"
                class="mt-1.5 w-full rounded-2xl border border-slate-200/70 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d5f6b]/30 focus:border-[#0d5f6b]/50"
              />
            </div>
          </div>
          <div>
            <label class="text-xs font-bold text-slate-500 uppercase tracking-wider">Username</label>
            <input
              v-model="form.username"
              type="text"
              placeholder="alex_j"
              class="mt-1.5 w-full rounded-2xl border border-slate-200/70 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d5f6b]/30 focus:border-[#0d5f6b]/50"
            />
          </div>
        </div>

        <button
          @click="next"
          :disabled="!step1Valid"
          class="mt-6 w-full rounded-2xl bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] py-3 text-sm font-bold text-white shadow-md disabled:opacity-40 transition"
        >
          Continue →
        </button>
      </div>

      <!-- ── STEP 2: Learning style ────────────────────────────────────────── -->
      <div v-else-if="step === 2" class="px-8 pb-8">
        <h2 class="text-xl font-bold text-slate-800 mb-1">How do you prefer to learn?</h2>
        <p class="text-sm text-slate-500 mb-5">The AI will tailor how it shares information and suggestions.</p>

        <div class="space-y-2.5">
          <button
            v-for="s in learningStyles"
            :key="s.value"
            @click="form.learningStyle = s.value"
            class="w-full text-left rounded-2xl border-2 px-4 py-3.5 transition-all duration-200"
            :class="form.learningStyle === s.value
              ? 'border-[#0d5f6b] bg-[#0d5f6b]/5'
              : 'border-slate-200/70 hover:border-slate-300 bg-white'"
          >
            <div class="flex items-center justify-between">
              <span class="text-sm font-bold" :class="form.learningStyle === s.value ? 'text-[#0d5f6b]' : 'text-slate-800'">{{ s.label }}</span>
              <div
                class="h-5 w-5 rounded-full border-2 flex items-center justify-center transition"
                :class="form.learningStyle === s.value ? 'border-[#0d5f6b] bg-[#0d5f6b]' : 'border-slate-300'"
              >
                <svg v-if="form.learningStyle === s.value" class="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </div>
            </div>
            <p class="text-xs text-slate-500 mt-0.5 leading-relaxed">{{ s.desc }}</p>
          </button>
        </div>

        <div class="flex gap-2 mt-6">
          <button @click="step--" class="rounded-2xl border border-slate-200/70 px-5 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">Back</button>
          <button
            @click="next"
            :disabled="!step2Valid"
            class="flex-1 rounded-2xl bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] py-3 text-sm font-bold text-white shadow-md disabled:opacity-40 transition"
          >Continue →</button>
        </div>
      </div>

      <!-- ── STEP 3: AI personality ─────────────────────────────────────────── -->
      <div v-else class="px-8 pb-8">
        <h2 class="text-xl font-bold text-slate-800 mb-1">How should the AI communicate?</h2>
        <p class="text-sm text-slate-500 mb-5">You can always change this later in your Profile settings.</p>

        <div class="space-y-2.5">
          <button
            v-for="p in personalities"
            :key="p.value"
            @click="form.aiPersonality = p.value"
            class="w-full text-left rounded-2xl border-2 px-4 py-3.5 transition-all duration-200"
            :class="form.aiPersonality === p.value
              ? 'border-[#0d5f6b] bg-[#0d5f6b]/5'
              : 'border-slate-200/70 hover:border-slate-300 bg-white'"
          >
            <div class="flex items-center justify-between">
              <span class="text-sm font-bold" :class="form.aiPersonality === p.value ? 'text-[#0d5f6b]' : 'text-slate-800'">{{ p.label }}</span>
              <div
                class="h-5 w-5 rounded-full border-2 flex items-center justify-center transition"
                :class="form.aiPersonality === p.value ? 'border-[#0d5f6b] bg-[#0d5f6b]' : 'border-slate-300'"
              >
                <svg v-if="form.aiPersonality === p.value" class="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </div>
            </div>
            <p class="text-xs text-slate-500 mt-0.5 leading-relaxed">{{ p.desc }}</p>
          </button>
        </div>

        <p v-if="error" class="mt-3 text-sm text-rose-500 bg-rose-50 rounded-xl px-3 py-2">{{ error }}</p>

        <div class="flex gap-2 mt-6">
          <button @click="step--" class="rounded-2xl border border-slate-200/70 px-5 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">Back</button>
          <button
            @click="save"
            :disabled="!step3Valid || saving"
            class="flex-1 rounded-2xl bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] py-3 text-sm font-bold text-white shadow-md disabled:opacity-40 transition"
          >
            <span v-if="saving">Setting up…</span>
            <span v-else>Let's go!</span>
          </button>
        </div>
      </div>

    </div>
  </div>
</template>
