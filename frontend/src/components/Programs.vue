<script setup>
// Programs.vue — list + detail view for the trainer's programs.
//
// The page has two modes:
//   - mode='list'   → grid of program cards with create/archive controls
//   - mode='detail' → per-program timeline (goals, entries, reflections in
//                     chronological order)
//
// Mode is internal state; we don't use vue-router for this so the parent
// (App.vue) treats Programs as a single view.

import { ref, computed, onMounted } from 'vue'
import { useApi } from '../composables/useApi.js'
import {
  CalendarDays, Users, Plus, Archive, ArchiveRestore, Trash2, Pencil, X,
  CheckCircle2, ArrowLeft, Sparkles, Target, BookOpen, Brain,
} from 'lucide-vue-next'

const emit = defineEmits(['navigate'])

const { apiFetch } = useApi()

// ── State ──────────────────────────────────────────────────────────────────
const mode       = ref('list')           // 'list' | 'detail'
const programs   = ref([])
const loading    = ref(true)
const error      = ref('')

// Detail state
const activeId      = ref(null)
const detail        = ref(null)           // { program, counts, items[] }
const detailLoading = ref(false)

// Status filter for list view
const statusFilter = ref('active')        // 'active' | 'completed' | 'archived' | 'all'

// Create/edit modal state
const editing       = ref(null)           // null | 'new' | <program object being edited>
const form          = ref({ name: '', description: '', status: 'active', startDate: '', endDate: '', learnerCount: '' })
const saving        = ref(false)
const formError     = ref('')

// ── Derived ────────────────────────────────────────────────────────────────
const visiblePrograms = computed(() => {
  if (statusFilter.value === 'all') return programs.value
  return programs.value.filter(p => p.status === statusFilter.value)
})

const counts = computed(() => ({
  active:    programs.value.filter(p => p.status === 'active').length,
  completed: programs.value.filter(p => p.status === 'completed').length,
  archived:  programs.value.filter(p => p.status === 'archived').length,
}))

// ── Load ───────────────────────────────────────────────────────────────────
async function load() {
  loading.value = true
  error.value   = ''
  try {
    programs.value = await apiFetch('/api/programs') || []
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

onMounted(load)

// ── Detail view ────────────────────────────────────────────────────────────
async function openDetail(id) {
  activeId.value      = id
  mode.value          = 'detail'
  detailLoading.value = true
  detail.value        = null
  try {
    detail.value = await apiFetch(`/api/programs/${id}/timeline`)
  } catch (e) {
    error.value = e.message
  } finally {
    detailLoading.value = false
  }
}

function backToList() {
  mode.value     = 'list'
  activeId.value = null
  detail.value   = null
}

// ── Create / edit ──────────────────────────────────────────────────────────
function startCreate() {
  form.value = { name: '', description: '', status: 'active', startDate: '', endDate: '', learnerCount: '' }
  formError.value = ''
  editing.value = 'new'
}

function startEdit(p) {
  form.value = {
    name:         p.name,
    description:  p.description || '',
    status:       p.status,
    startDate:    p.startDate || '',
    endDate:      p.endDate   || '',
    learnerCount: p.learnerCount ?? '',
  }
  formError.value = ''
  editing.value = p
}

function cancelEdit() {
  editing.value = null
  formError.value = ''
}

async function save() {
  if (!form.value.name.trim()) { formError.value = 'Name is required.'; return }
  saving.value = true
  formError.value = ''
  try {
    const body = {
      name:         form.value.name.trim(),
      description:  form.value.description.trim(),
      status:       form.value.status,
      startDate:    form.value.startDate || null,
      endDate:      form.value.endDate   || null,
      learnerCount: form.value.learnerCount === '' ? null : Number(form.value.learnerCount),
    }
    if (editing.value === 'new') {
      const created = await apiFetch('/api/programs', { method: 'POST', body: JSON.stringify(body) })
      programs.value = [created, ...programs.value]
    } else {
      const updated = await apiFetch(`/api/programs/${editing.value.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      programs.value = programs.value.map(p => p.id === updated.id ? updated : p)
    }
    editing.value = null
  } catch (e) {
    formError.value = e.message
  } finally {
    saving.value = false
  }
}

// ── Quick actions ──────────────────────────────────────────────────────────
async function setStatus(p, status) {
  try {
    const updated = await apiFetch(`/api/programs/${p.id}`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    })
    programs.value = programs.value.map(x => x.id === p.id ? updated : x)
  } catch (e) {
    alert('Failed to update: ' + e.message)
  }
}

async function deleteProgram(p) {
  const ok = window.confirm(
    `Delete "${p.name}"?\n\nGoals, journal entries, and reflections tagged to it will be kept but become untagged. This cannot be undone.`
  )
  if (!ok) return
  try {
    await apiFetch(`/api/programs/${p.id}`, { method: 'DELETE' })
    programs.value = programs.value.filter(x => x.id !== p.id)
  } catch (e) {
    alert('Failed to delete: ' + e.message)
  }
}

// ── Timeline item helpers ──────────────────────────────────────────────────
function itemIcon(kind) {
  if (kind === 'goal')       return Target
  if (kind === 'entry')      return BookOpen
  if (kind === 'reflection') return Brain
  return Sparkles
}
function itemLabel(it) {
  if (it.kind === 'goal')       return it.data.title || 'Goal'
  if (it.kind === 'entry')      return (it.data.text || '').slice(0, 80) + ((it.data.text?.length || 0) > 80 ? '…' : '')
  if (it.kind === 'reflection') return `Reflection — ${it.data.month || ''}`
  return ''
}
function itemDate(it) {
  return new Date(it.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function statusBadgeClass(s) {
  if (s === 'active')    return 'bg-teal-100 text-teal-700'
  if (s === 'completed') return 'bg-emerald-100 text-emerald-700'
  if (s === 'archived')  return 'bg-slate-100 text-slate-500'
  return 'bg-slate-100 text-slate-600'
}
</script>

<template>
  <div class="min-h-screen" style="background:var(--page-bg)">

    <!-- ═════════════════ LIST MODE ═══════════════════════════════════════════ -->
    <template v-if="mode === 'list'">
      <!-- Hero -->
      <div class="relative overflow-hidden" style="background:linear-gradient(135deg,#0b1a1c 0%,#0d5f6b 55%,#0e8095 100%)">
        <div class="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/5 blur-3xl" aria-hidden="true"></div>
        <div class="relative mx-auto max-w-4xl px-4 py-8">
          <div class="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 class="text-2xl font-extrabold text-white">Programs</h1>
              <p class="mt-1 text-sm text-teal-100/70 max-w-md">
                Your active cohorts, workshops, and learning programs. Tag goals, journal entries, and reflections to organize your work.
              </p>
            </div>
            <button
              @click="startCreate"
              class="btn btn-primary"
              style="background:linear-gradient(135deg,#2dd4bf,#0e8095);box-shadow:0 4px 20px rgba(45,212,191,0.35)"
            >
              <Plus class="h-4 w-4" aria-hidden="true" />
              New program
            </button>
          </div>
        </div>
      </div>

      <div class="mx-auto max-w-4xl px-4 py-8 space-y-6">

        <!-- Status filter pills -->
        <div class="flex items-center gap-2 flex-wrap" role="tablist" aria-label="Filter by status">
          <button
            v-for="s in [{ k: 'active', label: 'Active' }, { k: 'completed', label: 'Completed' }, { k: 'archived', label: 'Archived' }, { k: 'all', label: 'All' }]"
            :key="s.k"
            @click="statusFilter = s.k"
            role="tab"
            :aria-selected="statusFilter === s.k"
            class="rounded-full px-3 py-1 text-xs font-bold transition"
            :class="statusFilter === s.k
              ? 'bg-slate-800 text-white shadow-sm'
              : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'"
          >
            {{ s.label }}
            <span v-if="s.k !== 'all'" class="ml-1 opacity-60">{{ counts[s.k] || 0 }}</span>
          </button>
        </div>

        <p v-if="error" class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{{ error }}</p>

        <!-- Loading state -->
        <div v-if="loading" class="card py-12 text-center text-sm text-slate-400">Loading programs…</div>

        <!-- Empty state -->
        <div v-else-if="!programs.length" class="card flex flex-col items-center gap-4 py-16 text-center">
          <div class="flex h-16 w-16 items-center justify-center rounded-2xl" style="background:linear-gradient(135deg,#0d5f6b,#0e8095)">
            <CalendarDays class="h-8 w-8 text-white" aria-hidden="true" />
          </div>
          <div>
            <p class="font-bold text-slate-700">No programs yet</p>
            <p class="mt-1 max-w-md text-sm text-slate-400 leading-relaxed">
              Create your first program to start organizing your work — a cohort you're running, a workshop series, a leadership intensive, an onboarding pilot.
            </p>
          </div>
          <button @click="startCreate" class="btn btn-primary">
            <Plus class="h-4 w-4" aria-hidden="true" /> Create your first program
          </button>
        </div>

        <!-- Filtered-empty state -->
        <div v-else-if="!visiblePrograms.length" class="card py-8 text-center text-sm text-slate-400">
          No {{ statusFilter }} programs.
        </div>

        <!-- Program cards -->
        <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div
            v-for="p in visiblePrograms" :key="p.id"
            class="card p-5 cursor-pointer transition hover:shadow-md"
            @click="openDetail(p.id)"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <h3 class="font-bold text-slate-800 truncate">{{ p.name }}</h3>
                <p v-if="p.description" class="mt-1 text-xs text-slate-500 leading-relaxed line-clamp-2">{{ p.description }}</p>
              </div>
              <span class="shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider" :class="statusBadgeClass(p.status)">
                {{ p.status }}
              </span>
            </div>

            <div class="mt-3 flex items-center gap-3 text-xs text-slate-500">
              <span v-if="p.startDate || p.endDate" class="inline-flex items-center gap-1">
                <CalendarDays class="h-3 w-3" aria-hidden="true" />
                {{ p.startDate || '?' }} → {{ p.endDate || 'ongoing' }}
              </span>
              <span v-if="p.learnerCount !== null" class="inline-flex items-center gap-1">
                <Users class="h-3 w-3" aria-hidden="true" />
                {{ p.learnerCount }} learners
              </span>
            </div>

            <!-- Card-level quick actions -->
            <div class="mt-4 flex items-center gap-2 flex-wrap" @click.stop>
              <button
                @click="startEdit(p)"
                class="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
              ><Pencil class="h-3 w-3" aria-hidden="true" />Edit</button>

              <button
                v-if="p.status !== 'completed'"
                @click="setStatus(p, 'completed')"
                class="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
              ><CheckCircle2 class="h-3 w-3" aria-hidden="true" />Mark complete</button>

              <button
                v-if="p.status !== 'archived'"
                @click="setStatus(p, 'archived')"
                class="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
              ><Archive class="h-3 w-3" aria-hidden="true" />Archive</button>

              <button
                v-else
                @click="setStatus(p, 'active')"
                class="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-700 hover:bg-teal-100"
              ><ArchiveRestore class="h-3 w-3" aria-hidden="true" />Reactivate</button>

              <button
                @click="deleteProgram(p)"
                class="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 ml-auto"
                :aria-label="`Delete program ${p.name}`"
              ><Trash2 class="h-3 w-3" aria-hidden="true" />Delete</button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ═════════════════ DETAIL MODE ═══════════════════════════════════════ -->
    <template v-else-if="mode === 'detail'">
      <div class="relative overflow-hidden" style="background:linear-gradient(135deg,#0b1a1c 0%,#0d5f6b 55%,#0e8095 100%)">
        <div class="relative mx-auto max-w-3xl px-4 py-6">
          <button
            @click="backToList"
            class="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/20 hover:bg-white/15 mb-3"
          >
            <ArrowLeft class="h-3.5 w-3.5" aria-hidden="true" /> All programs
          </button>

          <div v-if="detailLoading" class="text-sm text-teal-100/70">Loading…</div>
          <div v-else-if="detail">
            <h1 class="text-2xl font-extrabold text-white">{{ detail.program.name }}</h1>
            <div class="mt-2 flex items-center gap-4 text-xs text-teal-100/70">
              <span class="inline-flex items-center gap-1"><Target class="h-3 w-3" aria-hidden="true" />{{ detail.counts.goals }} goals</span>
              <span class="inline-flex items-center gap-1"><BookOpen class="h-3 w-3" aria-hidden="true" />{{ detail.counts.entries }} entries</span>
              <span class="inline-flex items-center gap-1"><Brain class="h-3 w-3" aria-hidden="true" />{{ detail.counts.reflections }} reflections</span>
            </div>
          </div>
        </div>
      </div>

      <div class="mx-auto max-w-3xl px-4 py-8 space-y-4">
        <div v-if="detailLoading" class="card py-12 text-center text-sm text-slate-400">Loading timeline…</div>

        <div v-else-if="detail && !detail.items.length" class="card py-12 text-center">
          <p class="font-bold text-slate-700">Nothing tagged here yet</p>
          <p class="mt-1 text-sm text-slate-400">When you tag a goal, journal entry, or reflection to this program, it'll appear here.</p>
        </div>

        <div v-else-if="detail" class="space-y-3">
          <div v-for="(it, i) in detail.items" :key="`${it.kind}-${it.data.id}-${i}`" class="card px-4 py-3 flex items-start gap-3">
            <component :is="itemIcon(it.kind)" class="h-4 w-4 mt-0.5 shrink-0"
              :class="it.kind === 'goal' ? 'text-emerald-500' : it.kind === 'entry' ? 'text-violet-500' : 'text-rose-500'"
              aria-hidden="true" />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-slate-700">{{ itemLabel(it) }}</p>
              <p class="text-[11px] text-slate-400 mt-0.5 uppercase tracking-wider">{{ it.kind }} · {{ itemDate(it) }}</p>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ═════════════════ CREATE / EDIT MODAL ═══════════════════════════════ -->
    <div v-if="editing" class="fixed inset-0 z-50 flex items-center justify-center p-4"
         role="dialog" aria-modal="true" aria-labelledby="program-form-title">
      <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-md" aria-hidden="true" @click="cancelEdit"></div>
      <div class="relative z-10 w-full max-w-lg rounded-3xl bg-white shadow-2xl overflow-hidden">
        <div class="relative overflow-hidden px-6 py-5" style="background:linear-gradient(135deg,#0d5f6b,#0e8095)">
          <div class="flex items-center justify-between">
            <h2 id="program-form-title" class="text-base font-bold text-white">
              {{ editing === 'new' ? 'New program' : 'Edit program' }}
            </h2>
            <button @click="cancelEdit" aria-label="Cancel" class="text-white/70 hover:text-white">
              <X class="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <form @submit.prevent="save" class="px-6 py-5 space-y-4">
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Name <span class="text-rose-500">*</span></label>
            <input v-model="form.name" type="text" maxlength="120" required class="input w-full" placeholder="e.g. May Leadership Cohort" />
          </div>

          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Description</label>
            <textarea v-model="form.description" rows="2" maxlength="2000" class="input w-full resize-none" placeholder="Optional — a brief note about this program"></textarea>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Start date</label>
              <input v-model="form.startDate" type="date" class="input w-full" />
            </div>
            <div>
              <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">End date</label>
              <input v-model="form.endDate" type="date" class="input w-full" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Status</label>
              <select v-model="form.status" class="input w-full">
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Learners (optional)</label>
              <input v-model="form.learnerCount" type="number" min="0" class="input w-full" placeholder="e.g. 12" />
            </div>
          </div>

          <p v-if="formError" class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{{ formError }}</p>

          <div class="flex justify-end gap-2 pt-2">
            <button type="button" @click="cancelEdit" class="btn btn-ghost">Cancel</button>
            <button type="submit" :disabled="saving" class="btn btn-primary">{{ saving ? 'Saving…' : (editing === 'new' ? 'Create' : 'Save') }}</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
