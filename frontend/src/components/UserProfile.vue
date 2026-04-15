<script setup>
import { ref, onMounted, computed } from 'vue'
import { useAuth } from '../composables/useAuth.js'
import { useApi }  from '../composables/useApi.js'
import { User, Trophy, Star, Pencil, X, Save, ChevronRight } from 'lucide-vue-next'

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
  <div class="min-h-screen" style="background:var(--page-bg)">

    <!-- ── Hero banner ────────────────────────────────────────────────────────── -->
    <div class="relative overflow-hidden bg-slate-800">
      <div class="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/5 blur-3xl"></div>
      <div class="pointer-events-none absolute bottom-0 left-1/3 h-40 w-40 rounded-full bg-teal-500/10 blur-2xl"></div>

      <div class="relative mx-auto max-w-3xl px-6 py-8">
        <div class="flex items-center justify-between gap-4">
          <!-- Avatar + name -->
          <div class="flex items-center gap-4">
            <div
              class="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl shadow-xl ring-4 ring-white/10"
              style="background:linear-gradient(135deg,#0d5f6b,#0ea5e9)"
            >
              <span class="text-2xl font-extrabold text-white">{{ (profile?.firstName || user?.email || '?')[0].toUpperCase() }}</span>
            </div>
            <div>
              <h1 class="text-xl font-extrabold text-white">{{ displayName }}</h1>
              <p class="mt-0.5 text-sm text-slate-400">{{ user?.email }}</p>
              <p v-if="profile?.username" class="mt-0.5 text-xs text-slate-500">@{{ profile.username }}</p>
            </div>
          </div>

          <!-- Edit button -->
          <button
            v-if="!editing"
            @click="startEdit"
            class="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/20"
          >
            <Pencil class="h-4 w-4" />
            Edit profile
          </button>
          <button
            v-else
            @click="cancelEdit"
            class="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/20"
          >
            <X class="h-4 w-4" />
            Cancel
          </button>
        </div>
      </div>
    </div>

    <div class="mx-auto max-w-3xl space-y-6 px-4 py-8">

      <!-- ── Stats ──────────────────────────────────────────────────────────── -->
      <div class="grid grid-cols-2 gap-4">
        <div class="card p-6">
          <div class="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100">
            <Trophy class="h-5 w-5 text-emerald-600" />
          </div>
          <div class="text-3xl font-extrabold text-emerald-600">{{ stats.goalsMet }}</div>
          <div class="mt-0.5 text-xs font-bold uppercase tracking-wider text-emerald-700">Goals Met</div>
          <div class="mt-0.5 text-xs text-slate-400">Across all months</div>
        </div>
        <div class="card p-6">
          <div class="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100">
            <Star class="h-5 w-5 text-amber-600" />
          </div>
          <div class="text-3xl font-extrabold text-amber-600">{{ stats.totalWins }}</div>
          <div class="mt-0.5 text-xs font-bold uppercase tracking-wider text-amber-700">Wins Captured</div>
          <div class="mt-0.5 text-xs text-slate-400">From journal entries</div>
        </div>
      </div>

      <!-- ── Profile card: VIEW mode ─────────────────────────────────────────── -->
      <div v-if="!editing" class="card overflow-hidden animate-fade-up">
        <div class="border-b border-slate-100 px-6 py-5">
          <h2 class="font-bold text-slate-800">Profile details</h2>
        </div>
        <div class="divide-y divide-slate-100">
          <div class="grid grid-cols-2 gap-4 px-6 py-4">
            <div>
              <p class="text-xs font-bold uppercase tracking-wider text-slate-400">First name</p>
              <p class="mt-1 text-sm font-semibold text-slate-800">{{ profile?.firstName || '—' }}</p>
            </div>
            <div>
              <p class="text-xs font-bold uppercase tracking-wider text-slate-400">Last name</p>
              <p class="mt-1 text-sm font-semibold text-slate-800">{{ profile?.lastName || '—' }}</p>
            </div>
          </div>
          <div class="px-6 py-4">
            <p class="text-xs font-bold uppercase tracking-wider text-slate-400">Username</p>
            <p class="mt-1 text-sm font-semibold text-slate-800">{{ profile?.username ? '@' + profile.username : '—' }}</p>
          </div>
          <div class="grid grid-cols-2 gap-4 px-6 py-4">
            <div>
              <p class="text-xs font-bold uppercase tracking-wider text-slate-400">Learning Style</p>
              <p class="mt-1 text-sm font-semibold text-slate-800">{{ learningLabels[profile?.learningStyle] || '—' }}</p>
            </div>
            <div>
              <p class="text-xs font-bold uppercase tracking-wider text-slate-400">AI Personality</p>
              <p class="mt-1 text-sm font-semibold text-slate-800">{{ personalityLabels[profile?.aiPersonality] || '—' }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Profile card: EDIT mode ─────────────────────────────────────────── -->
      <div v-else class="card overflow-hidden animate-fade-up">
        <div class="border-b border-slate-100 px-6 py-5">
          <h2 class="font-bold text-slate-800">Edit profile</h2>
        </div>

        <form @submit.prevent="save" class="space-y-6 px-6 py-6">
          <!-- Name fields -->
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-400">
                First name <span class="text-rose-400">*</span>
              </label>
              <input v-model="form.firstName" type="text" class="input" placeholder="Jane" />
            </div>
            <div>
              <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-400">Last name</label>
              <input v-model="form.lastName" type="text" class="input" placeholder="Smith" />
            </div>
          </div>

          <!-- Username -->
          <div>
            <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-400">Username</label>
            <input v-model="form.username" type="text" class="input" placeholder="janesmith" />
          </div>

          <!-- Learning style -->
          <div>
            <label class="mb-3 block text-xs font-bold uppercase tracking-wider text-slate-400">Learning style</label>
            <div class="grid grid-cols-2 gap-2">
              <button
                v-for="s in learningStyles"
                :key="s.value"
                type="button"
                @click="form.learningStyle = s.value"
                class="rounded-xl border-2 px-4 py-3 text-left transition-all duration-150"
                :class="form.learningStyle === s.value
                  ? 'border-[#0d5f6b] bg-[#0d5f6b]/5 text-[#0d5f6b]'
                  : 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white'"
              >
                <span class="block text-xs font-bold">{{ s.label }}</span>
                <span class="mt-0.5 block text-[11px] opacity-70">{{ s.desc }}</span>
              </button>
            </div>
          </div>

          <!-- AI personality -->
          <div>
            <label class="mb-3 block text-xs font-bold uppercase tracking-wider text-slate-400">AI coach personality</label>
            <div class="grid grid-cols-3 gap-2">
              <button
                v-for="p in personalities"
                :key="p.value"
                type="button"
                @click="form.aiPersonality = p.value"
                class="rounded-xl border-2 px-3 py-3 text-left transition-all duration-150"
                :class="form.aiPersonality === p.value
                  ? 'border-[#0d5f6b] bg-[#0d5f6b]/5 text-[#0d5f6b]'
                  : 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white'"
              >
                <span class="block text-xs font-bold">{{ p.label }}</span>
                <span class="mt-0.5 block text-[11px] opacity-60 leading-tight">{{ p.desc }}</span>
              </button>
            </div>
          </div>

          <!-- Error -->
          <div v-if="error" class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{{ error }}</div>

          <!-- Actions -->
          <div class="flex gap-3 pt-1">
            <button
              type="button"
              @click="cancelEdit"
              class="btn btn-ghost flex-none rounded-xl"
            >Cancel</button>
            <button
              type="submit"
              :disabled="saving"
              class="btn btn-primary flex-1 justify-center rounded-xl disabled:opacity-50"
            >
              <span v-if="saving" class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
              <Save v-else class="h-4 w-4" />
              {{ saving ? 'Saving…' : 'Save changes' }}
            </button>
          </div>
        </form>
      </div>

    </div>
  </div>
</template>
