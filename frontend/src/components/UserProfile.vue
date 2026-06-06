<script setup>
import { ref, onMounted, computed } from 'vue'
import { useAuth } from '../composables/useAuth.js'
import { useApi }  from '../composables/useApi.js'
import { User, Trophy, Star, Pencil, X, Save, ChevronRight, AlertTriangle, Trash2 } from 'lucide-vue-next'

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

// ── Clean slate (user-initiated data wipe) ───────────────────────────────────
// Two-step: confirm intent, then re-enter password. Password re-entry is the
// human-verification step — a stolen session token alone can't trigger this.
const cleaning           = ref(false)
const cleanResult        = ref(null)
const cleanError         = ref('')
const cleanConfirming    = ref(false)   // password-entry panel visible?
const cleanPassword      = ref('')

function startCleanSlate() {
  cleanError.value      = ''
  cleanResult.value     = null
  cleanPassword.value   = ''
  cleanConfirming.value = true
}

function cancelCleanSlate() {
  cleanConfirming.value = false
  cleanPassword.value   = ''
  cleanError.value      = ''
}

async function confirmCleanSlate() {
  if (!cleanPassword.value) {
    cleanError.value = 'Enter your password to confirm.'
    return
  }
  cleaning.value   = true
  cleanError.value = ''
  try {
    const res = await apiFetch('/api/account/clean-slate', {
      method: 'POST',
      body: JSON.stringify({ password: cleanPassword.value }),
    })
    cleanResult.value     = res.results
    cleanConfirming.value = false
    cleanPassword.value   = ''
    // Force-refresh stats + tell the rest of the app to reload
    await loadStats()
    emit('updated', props.profile)   // bumps key in App.vue
  } catch (e) {
    cleanError.value = e.message
  } finally {
    cleaning.value = false
  }
}
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

      <!-- ── Danger zone — erase all data for this account ───────────────────── -->
      <div class="rounded-3xl border-2 border-dashed border-rose-200 bg-rose-50/30 p-6 mt-6">
        <div class="flex items-start gap-3 mb-3">
          <div class="shrink-0 h-9 w-9 rounded-xl bg-rose-100 flex items-center justify-center">
            <AlertTriangle class="h-5 w-5 text-rose-600" />
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="text-sm font-bold text-rose-700">Danger zone — erase my data</h3>
            <p class="text-xs text-rose-600/80 mt-0.5 leading-relaxed">
              Wipes every goal, journal entry, reflection, program, LC chat history,
              and the encrypted name registry LC uses for memory.
              Your login and profile stay intact. This cannot be undone.
            </p>
          </div>
        </div>

        <!-- Step 1: trigger button (hidden once the confirm panel is open) -->
        <button
          v-if="!cleanConfirming"
          type="button"
          @click="startCleanSlate"
          class="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-rose-700"
        >
          <Trash2 class="h-4 w-4" />
          Erase my data
        </button>

        <!-- Step 2: password re-entry to prove a human is behind the click -->
        <form
          v-else
          @submit.prevent="confirmCleanSlate"
          class="mt-1 rounded-xl bg-white border border-rose-300 p-4 space-y-3"
        >
          <p class="text-xs text-rose-700">
            Re-enter your password to confirm. This protects against accidental
            clicks and stolen-session deletions.
          </p>
          <input
            v-model="cleanPassword"
            type="password"
            autocomplete="current-password"
            placeholder="Account password"
            :disabled="cleaning"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
          />
          <div class="flex items-center gap-2">
            <button
              type="submit"
              :disabled="cleaning || !cleanPassword"
              class="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-50"
            >
              <span v-if="cleaning" class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
              <Trash2 v-else class="h-4 w-4" />
              {{ cleaning ? 'Wiping…' : 'Confirm erase' }}
            </button>
            <button
              type="button"
              @click="cancelCleanSlate"
              :disabled="cleaning"
              class="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>

        <!-- Result -->
        <div v-if="cleanResult" class="mt-3 rounded-xl bg-white border border-rose-200 px-4 py-3 text-xs">
          <p class="font-bold text-rose-700 mb-1.5">Done. Deleted:</p>
          <ul class="space-y-0.5 text-slate-600">
            <li v-for="(r, table) in cleanResult" :key="table">
              <span class="font-mono text-[11px]">{{ table }}:</span>
              <span v-if="r.error" class="text-rose-500"> {{ r.error }}</span>
              <span v-else> {{ r.deleted }} row{{ r.deleted === 1 ? '' : 's' }}</span>
            </li>
          </ul>
        </div>

        <!-- Error -->
        <div v-if="cleanError" class="mt-3 rounded-xl bg-rose-100 border border-rose-300 px-4 py-2.5 text-xs text-rose-700">
          {{ cleanError }}
        </div>
      </div>

    </div>
  </div>
</template>
