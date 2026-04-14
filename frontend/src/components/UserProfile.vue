<script setup>
import { ref, onMounted, computed } from 'vue'
import { useAuth } from '../composables/useAuth.js'
import { useApi }  from '../composables/useApi.js'

const props = defineProps({
  profile: { type: Object, default: null },
})
const emit = defineEmits(['updated'])

const { user } = useAuth()
const { apiFetch } = useApi()

// ── State ─────────────────────────────────────────────────────────────────────
const editing = ref(false)
const saving  = ref(false)
const error   = ref('')
const stats   = ref({ goalsMet: 0, totalWins: 0 })

const form = ref({
  firstName:    '',
  lastName:     '',
  username:     '',
  learningStyle: '',
  aiPersonality: '',
})

const learningLabels = {
  visual:       'Visual',
  auditory:     'Auditory',
  reading:      'Reading / Writing',
  kinesthetic:  'Hands-on',
}
const personalityLabels = {
  warm:    'Warm & Encouraging',
  direct:  'Direct & Concise',
  neutral: 'Balanced',
}

const learningStyles = [
  { value: 'visual',      label: 'Visual',           desc: 'Images, diagrams, and visual layout.' },
  { value: 'auditory',    label: 'Auditory',          desc: 'Listening, talking, verbal explanation.' },
  { value: 'reading',     label: 'Reading / Writing', desc: 'Reading and writing notes.' },
  { value: 'kinesthetic', label: 'Hands-on',          desc: 'Doing, practising, real examples.' },
]
const personalities = [
  { value: 'warm',   label: 'Warm & Encouraging', desc: 'Uplifting and celebratory.' },
  { value: 'direct', label: 'Direct & Concise',   desc: 'Clear, efficient, no filler.' },
  { value: 'neutral', label: 'Balanced',           desc: 'Friendly but professional.' },
]

// ── Init ──────────────────────────────────────────────────────────────────────
onMounted(async () => {
  syncForm()
  await loadStats()
})

function syncForm() {
  if (props.profile) {
    form.value.firstName    = props.profile.firstName    || ''
    form.value.lastName     = props.profile.lastName     || ''
    form.value.username     = props.profile.username     || ''
    form.value.learningStyle = props.profile.learningStyle || ''
    form.value.aiPersonality = props.profile.aiPersonality || ''
  }
}

async function loadStats() {
  try {
    stats.value = await apiFetch('/api/profile/stats')
  } catch { /* non-critical */ }
}

// ── Edit / Save ───────────────────────────────────────────────────────────────
function startEdit() {
  syncForm()
  editing.value = true
  error.value   = ''
}

function cancelEdit() {
  editing.value = false
  error.value   = ''
}

async function save() {
  if (!form.value.firstName.trim()) { error.value = 'First name is required.'; return }
  saving.value = true
  error.value  = ''
  try {
    const updated = await apiFetch('/api/profile', {
      method: 'POST',
      body: JSON.stringify(form.value),
    })
    editing.value = false
    emit('updated', updated)
  } catch (e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}

const displayName = computed(() => {
  if (!props.profile) return user.value?.email ?? ''
  const { firstName, lastName } = props.profile
  return [firstName, lastName].filter(Boolean).join(' ') || props.profile.username || user.value?.email
})
</script>

<template>
  <main class="mx-auto max-w-2xl px-4 py-8 space-y-6">

    <!-- Header -->
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-bold text-slate-800">My Profile</h2>
      <button
        v-if="!editing"
        @click="startEdit"
        class="rounded-xl border border-slate-200/70 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition shadow-sm"
      >
        Edit
      </button>
    </div>

    <!-- ── Stats ──────────────────────────────────────────────────────────────── -->
    <div class="grid grid-cols-2 gap-4">
      <div class="rounded-2xl border border-emerald-200/50 bg-gradient-to-br from-emerald-50 to-teal-50/40 p-5 shadow-sm">
        <div class="text-3xl font-extrabold text-emerald-600">{{ stats.goalsMet }}</div>
        <div class="text-xs font-bold text-emerald-700 uppercase tracking-wider mt-1">Goals Met</div>
        <div class="text-xs text-emerald-600/70 mt-0.5">Across all months</div>
      </div>
      <div class="rounded-2xl border border-amber-200/50 bg-gradient-to-br from-amber-50 to-orange-50/40 p-5 shadow-sm">
        <div class="text-3xl font-extrabold text-amber-600">{{ stats.totalWins }}</div>
        <div class="text-xs font-bold text-amber-700 uppercase tracking-wider mt-1">Wins Captured</div>
        <div class="text-xs text-amber-600/70 mt-0.5">From journal entries</div>
      </div>
    </div>

    <!-- ── Profile card ───────────────────────────────────────────────────────── -->
    <div class="rounded-2xl border border-slate-200/60 bg-white shadow-sm overflow-hidden">

      <!-- View mode -->
      <div v-if="!editing" class="divide-y divide-slate-100">
        <div class="px-6 py-5 flex items-center gap-4">
          <div class="h-14 w-14 rounded-2xl bg-gradient-to-br from-[#0d5f6b] to-[#0a4a54] flex items-center justify-center shadow-md flex-shrink-0">
            <span class="text-2xl font-bold text-white">{{ (profile?.firstName || user?.email || '?')[0].toUpperCase() }}</span>
          </div>
          <div>
            <p class="text-lg font-bold text-slate-800">{{ displayName }}</p>
            <p class="text-sm text-slate-500">{{ user?.email }}</p>
            <p v-if="profile?.username" class="text-xs text-slate-400 mt-0.5">@{{ profile.username }}</p>
          </div>
        </div>

        <div class="px-6 py-4 grid grid-cols-2 gap-4">
          <div>
            <p class="text-xs font-bold text-slate-400 uppercase tracking-wider">Learning Style</p>
            <p class="text-sm text-slate-700 mt-1 font-medium">{{ learningLabels[profile?.learningStyle] || '—' }}</p>
          </div>
          <div>
            <p class="text-xs font-bold text-slate-400 uppercase tracking-wider">AI Personality</p>
            <p class="text-sm text-slate-700 mt-1 font-medium">{{ personalityLabels[profile?.aiPersonality] || '—' }}</p>
          </div>
        </div>
      </div>

      <!-- Edit mode -->
      <form v-else @submit.prevent="save" class="px-6 py-6 space-y-5">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs font-bold text-slate-500 uppercase tracking-wider">First name <span class="text-rose-400">*</span></label>
            <input
              v-model="form.firstName"
              type="text"
              class="mt-1.5 w-full rounded-2xl border border-slate-200/70 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d5f6b]/30"
            />
          </div>
          <div>
            <label class="text-xs font-bold text-slate-500 uppercase tracking-wider">Last name</label>
            <input
              v-model="form.lastName"
              type="text"
              class="mt-1.5 w-full rounded-2xl border border-slate-200/70 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d5f6b]/30"
            />
          </div>
        </div>
        <div>
          <label class="text-xs font-bold text-slate-500 uppercase tracking-wider">Username</label>
          <input
            v-model="form.username"
            type="text"
            class="mt-1.5 w-full rounded-2xl border border-slate-200/70 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d5f6b]/30"
          />
        </div>

        <!-- Learning style -->
        <div>
          <label class="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Learning Style</label>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="s in learningStyles"
              :key="s.value"
              type="button"
              @click="form.learningStyle = s.value"
              class="text-left rounded-xl border-2 px-3 py-2.5 text-xs transition"
              :class="form.learningStyle === s.value
                ? 'border-[#0d5f6b] bg-[#0d5f6b]/5 text-[#0d5f6b] font-bold'
                : 'border-slate-200/70 text-slate-600 hover:border-slate-300'"
            >{{ s.label }}</button>
          </div>
        </div>

        <!-- AI personality -->
        <div>
          <label class="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">AI Personality</label>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="p in personalities"
              :key="p.value"
              type="button"
              @click="form.aiPersonality = p.value"
              class="text-left rounded-xl border-2 px-3 py-2.5 text-xs transition"
              :class="form.aiPersonality === p.value
                ? 'border-[#0d5f6b] bg-[#0d5f6b]/5 text-[#0d5f6b] font-bold'
                : 'border-slate-200/70 text-slate-600 hover:border-slate-300'"
            >{{ p.label }}</button>
          </div>
        </div>

        <p v-if="error" class="text-sm text-rose-500 bg-rose-50 rounded-xl px-3 py-2">{{ error }}</p>

        <div class="flex gap-2 pt-1">
          <button
            type="button"
            @click="cancelEdit"
            class="rounded-2xl border border-slate-200/70 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
          >Cancel</button>
          <button
            type="submit"
            :disabled="saving"
            class="flex-1 rounded-2xl bg-gradient-to-r from-[#0d5f6b] to-[#0a4a54] py-2.5 text-sm font-bold text-white shadow-md disabled:opacity-40 transition"
          >{{ saving ? 'Saving…' : 'Save changes' }}</button>
        </div>
      </form>

    </div>

  </main>
</template>
