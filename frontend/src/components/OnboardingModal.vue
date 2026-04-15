<script setup>
import { ref, computed } from 'vue'
import { useApi } from '../composables/useApi.js'
import {
  Sparkles, Eye, Headphones, BookOpen, Wrench,
  Heart, Zap, Layers, ArrowRight, ChevronLeft, Check,
} from 'lucide-vue-next'

const emit = defineEmits(['done'])

const { apiFetch } = useApi()

// ── State ─────────────────────────────────────────────────────────────────────
const step    = ref(1)
const saving  = ref(false)
const error   = ref('')

const form = ref({
  firstName:     '',
  lastName:      '',
  learningStyle: '',
  aiPersonality: '',
})

// ── Learning style options ────────────────────────────────────────────────────
const learningStyles = [
  { value: 'visual',      label: 'Visual',           desc: 'Images, diagrams, and seeing information laid out.', icon: Eye,        color: '#7c3aed', bg: '#ede9fe' },
  { value: 'auditory',    label: 'Auditory',          desc: 'Listening, talking through ideas, verbal explanation.', icon: Headphones,  color: '#0369a1', bg: '#e0f2fe' },
  { value: 'reading',     label: 'Reading / Writing', desc: 'Reading text and writing notes to absorb information.', icon: BookOpen,    color: '#047857', bg: '#d1fae5' },
  { value: 'kinesthetic', label: 'Hands-on',          desc: 'Doing, practising, and working through real examples.', icon: Wrench,      color: '#c2410c', bg: '#ffedd5' },
]

// ── AI personality options ────────────────────────────────────────────────────
const personalities = [
  { value: 'warm',    label: 'Warm & Encouraging', desc: 'Uplifting and celebratory — feels like a supportive friend.',  icon: Heart,  color: '#be185d', bg: '#fce7f3' },
  { value: 'direct',  label: 'Direct & Concise',   desc: 'Clear and efficient — no filler, just what you need.',         icon: Zap,    color: '#0369a1', bg: '#e0f2fe' },
  { value: 'neutral', label: 'Balanced',            desc: 'Friendly but professional — encouraging and practical.',       icon: Layers, color: '#0d5f6b', bg: '#e0f5f7' },
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
    <div class="absolute inset-0 bg-slate-900/65 backdrop-blur-md" />

    <!-- Modal -->
    <div
      class="relative z-10 w-full max-w-md flex flex-col rounded-3xl overflow-hidden animate-scale-in"
      style="box-shadow: var(--shadow-modal)"
    >

      <!-- ── Brand header ────────────────────────────────────────────────────── -->
      <div
        class="relative overflow-hidden px-8 pt-8 pb-6"
        style="background: linear-gradient(135deg, #0b1a1c 0%, #0d5f6b 60%, #0e8095 100%)"
      >
        <!-- Decorative blobs -->
        <div class="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/5" />
        <div class="pointer-events-none absolute -left-8 -bottom-8 h-32 w-32 rounded-full bg-white/5" />
        <div class="pointer-events-none absolute inset-0"
             style="background: radial-gradient(ellipse at 80% 20%, rgba(45,212,191,0.15) 0%, transparent 60%)" />

        <div class="relative">
          <!-- Logo + wordmark -->
          <div class="flex items-center gap-3 mb-6">
            <div class="h-11 w-11 rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shadow-lg" style="box-shadow: 0 4px 20px rgba(45,212,191,0.4)">
              <Sparkles class="h-5 w-5 text-white" />
            </div>
            <div>
              <span class="text-lg font-extrabold text-white tracking-tight">Celebrating Wins</span>
              <p class="text-xs text-teal-300/80">Your personal growth companion</p>
            </div>
          </div>

          <!-- Step content label -->
          <div>
            <p class="text-xs font-bold text-teal-300/70 uppercase tracking-widest mb-1">Step {{ step }} of 3</p>
            <h2 class="text-xl font-extrabold text-white leading-tight">
              <span v-if="step === 1">Welcome! Let's set up<br>your profile.</span>
              <span v-else-if="step === 2">How do you prefer<br>to learn?</span>
              <span v-else>How should the AI<br>talk to you?</span>
            </h2>
            <p class="mt-1 text-sm text-teal-100/60">
              <span v-if="step === 1">Personalises your experience — the AI will greet you by name.</span>
              <span v-else-if="step === 2">The AI tailors how it shares information and suggestions.</span>
              <span v-else>You can always change this later in your Profile settings.</span>
            </p>
          </div>
        </div>

        <!-- Step progress dots -->
        <div class="relative flex items-center gap-2 mt-6">
          <div
            v-for="n in 3"
            :key="n"
            class="h-1.5 rounded-full transition-all duration-500"
            :style="{
              width: n === step ? '28px' : '8px',
              background: n <= step ? '#2dd4bf' : 'rgba(255,255,255,0.2)',
            }"
          />
        </div>
      </div>

      <!-- ── Content area ────────────────────────────────────────────────────── -->
      <div class="bg-white px-8 py-7">

        <!-- ─ STEP 1: Basic info ──────────────────────────────────────────── -->
        <div v-if="step === 1" class="animate-fade-up">
          <div class="space-y-4">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  First name <span class="text-rose-400">*</span>
                </label>
                <input
                  v-model="form.firstName"
                  type="text"
                  placeholder="Alex"
                  class="input"
                />
              </div>
              <div>
                <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Last name</label>
                <input
                  v-model="form.lastName"
                  type="text"
                  placeholder="Johnson"
                  class="input"
                />
              </div>
            </div>
          </div>

          <button
            @click="next"
            :disabled="!step1Valid"
            class="btn btn-primary w-full mt-6 justify-center"
          >
            Continue
            <ArrowRight class="h-4 w-4" />
          </button>
        </div>

        <!-- ─ STEP 2: Learning style ─────────────────────────────────────── -->
        <div v-else-if="step === 2" class="animate-fade-up">
          <p class="text-xs text-slate-400 mb-3 flex items-center gap-1.5">
            <span class="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500">1</span>
            Choose the one that resonates most with you — just pick one.
          </p>
          <div class="space-y-2.5">
            <button
              v-for="s in learningStyles"
              :key="s.value"
              @click="form.learningStyle = s.value"
              class="w-full text-left rounded-2xl border-2 px-4 py-3.5 transition-all duration-200 flex items-center gap-3.5 group"
              :style="form.learningStyle === s.value
                ? { borderColor: s.color, background: s.bg }
                : { borderColor: '#e5e7eb', background: 'white' }"
            >
              <!-- Icon bubble -->
              <div
                class="h-9 w-9 shrink-0 rounded-xl flex items-center justify-center transition-all duration-200"
                :style="form.learningStyle === s.value
                  ? { background: s.color }
                  : { background: '#f1f5f9' }"
              >
                <component
                  :is="s.icon"
                  class="h-4 w-4 transition-colors duration-200"
                  :style="{ color: form.learningStyle === s.value ? 'white' : '#64748b' }"
                />
              </div>
              <!-- Text -->
              <div class="flex-1 min-w-0">
                <div
                  class="text-sm font-bold transition-colors"
                  :style="{ color: form.learningStyle === s.value ? s.color : '#1e293b' }"
                >{{ s.label }}</div>
                <p class="text-xs text-slate-500 leading-relaxed mt-0.5">{{ s.desc }}</p>
              </div>
              <!-- Radio -->
              <div
                class="h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center transition-all duration-200"
                :style="form.learningStyle === s.value
                  ? { borderColor: s.color, background: s.color }
                  : { borderColor: '#cbd5e1', background: 'white' }"
              >
                <Check v-if="form.learningStyle === s.value" class="h-3 w-3 text-white" />
              </div>
            </button>
          </div>

          <div class="flex gap-2.5 mt-6">
            <button @click="step--" class="btn btn-ghost">
              <ChevronLeft class="h-4 w-4" />
              Back
            </button>
            <button
              @click="next"
              :disabled="!step2Valid"
              class="btn btn-primary flex-1 justify-center"
            >
              Continue
              <ArrowRight class="h-4 w-4" />
            </button>
          </div>
        </div>

        <!-- ─ STEP 3: AI personality ─────────────────────────────────────── -->
        <div v-else class="animate-fade-up">
          <div class="space-y-2.5">
            <button
              v-for="p in personalities"
              :key="p.value"
              @click="form.aiPersonality = p.value"
              class="w-full text-left rounded-2xl border-2 px-4 py-3.5 transition-all duration-200 flex items-center gap-3.5"
              :style="form.aiPersonality === p.value
                ? { borderColor: p.color, background: p.bg }
                : { borderColor: '#e5e7eb', background: 'white' }"
            >
              <!-- Icon bubble -->
              <div
                class="h-9 w-9 shrink-0 rounded-xl flex items-center justify-center transition-all duration-200"
                :style="form.aiPersonality === p.value
                  ? { background: p.color }
                  : { background: '#f1f5f9' }"
              >
                <component
                  :is="p.icon"
                  class="h-4 w-4 transition-colors duration-200"
                  :style="{ color: form.aiPersonality === p.value ? 'white' : '#64748b' }"
                />
              </div>
              <!-- Text -->
              <div class="flex-1 min-w-0">
                <div
                  class="text-sm font-bold transition-colors"
                  :style="{ color: form.aiPersonality === p.value ? p.color : '#1e293b' }"
                >{{ p.label }}</div>
                <p class="text-xs text-slate-500 leading-relaxed mt-0.5">{{ p.desc }}</p>
              </div>
              <!-- Radio -->
              <div
                class="h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center transition-all duration-200"
                :style="form.aiPersonality === p.value
                  ? { borderColor: p.color, background: p.color }
                  : { borderColor: '#cbd5e1', background: 'white' }"
              >
                <Check v-if="form.aiPersonality === p.value" class="h-3 w-3 text-white" />
              </div>
            </button>
          </div>

          <!-- Error -->
          <p v-if="error" class="mt-3 text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{{ error }}</p>

          <div class="flex gap-2.5 mt-6">
            <button @click="step--" class="btn btn-ghost">
              <ChevronLeft class="h-4 w-4" />
              Back
            </button>
            <button
              @click="save"
              :disabled="!step3Valid || saving"
              class="btn btn-primary flex-1 justify-center"
            >
              <span v-if="saving">Setting up…</span>
              <template v-else>
                <Sparkles class="h-4 w-4" />
                Let's go!
              </template>
            </button>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>
