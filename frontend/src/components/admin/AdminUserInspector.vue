<script setup>
import { ref, onMounted, computed } from 'vue'
import { useApi } from '../../composables/useApi.js'
import {
  ChevronRight, ArrowLeft, AlertTriangle, Trash2, MessageSquare,
  ShieldCheck, ShieldOff, Eye, Target, BookText, Layers, Sparkles,
} from 'lucide-vue-next'

const { apiFetch } = useApi()

const users   = ref([])
const loading = ref(true)
const error   = ref('')
const filter  = ref('')

const selectedId    = ref(null)
const detail        = ref(null)
const detailLoading = ref(false)
const detailError   = ref('')

// Sub-page navigation inside a user's record. 'dashboard' = the counts grid;
// clicking a tile opens the section list. Each list shows full timestamps so
// bursts (e.g. fuzzer activity that all shares one calendar date) stay
// distinguishable.
const view = ref('dashboard') // 'dashboard' | 'goals' | 'entries' | 'chats' | 'reflections' | 'programs'
function openSection(s) { view.value = s }
function backToDashboard() { view.value = 'dashboard'; expandedChatId.value = null }

const expandedChatId = ref(null)
function toggleChat(id) {
  expandedChatId.value = expandedChatId.value === id ? null : id
  if (expandedChatId.value) loadAuditForChat(expandedChatId.value)
}

// ── Role management ─────────────────────────────────────────────────────────
const roleSaving  = ref(false)
const roleMessage = ref('')
const roleError   = ref('')
async function setRole(nextRole) {
  if (!detail.value) return
  roleSaving.value = true
  roleError.value = ''
  roleMessage.value = ''
  try {
    const res = await apiFetch(`/api/admin/users/${selectedId.value}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role: nextRole }),
    })
    detail.value.profile = { ...(detail.value.profile || {}), role: nextRole }
    roleMessage.value = res.warning || (nextRole === 'admin' ? 'Promoted to admin.' : 'Demoted to user.')
    loadUsers()
  } catch (e) {
    roleError.value = e.message || 'Role change failed'
  } finally {
    roleSaving.value = false
  }
}

// ── Audit (pseudonymized side-by-side) ─────────────────────────────────────
const auditByChatId = ref({})
async function loadAuditForChat(conversationId) {
  if (auditByChatId.value[conversationId]?.turns) return
  auditByChatId.value[conversationId] = { loading: true, error: '', turns: null }
  try {
    const res = await apiFetch(
      `/api/admin/users/${selectedId.value}/conversations/${conversationId}/audit`
    )
    auditByChatId.value[conversationId] = { loading: false, error: '', turns: res.turns || [] }
  } catch (e) {
    auditByChatId.value[conversationId] = { loading: false, error: e.message || 'Audit fetch failed', turns: [] }
  }
}
const chatViewMode = ref({})
function setChatView(chatId, mode) { chatViewMode.value = { ...chatViewMode.value, [chatId]: mode } }

const deleting   = ref(false)
const deleteConfirmTyping = ref('')
const deleteError = ref('')
const showDeleteUI = ref(false)
function openDeleteUI() {
  deleteError.value = ''
  deleteConfirmTyping.value = ''
  showDeleteUI.value = true
}
function cancelDelete() {
  showDeleteUI.value = false
  deleteConfirmTyping.value = ''
  deleteError.value = ''
}
async function confirmDelete() {
  if (deleteConfirmTyping.value.trim() !== detail.value?.email) {
    deleteError.value = 'Type the user’s email exactly to confirm.'
    return
  }
  deleting.value = true
  deleteError.value = ''
  try {
    await apiFetch(`/api/admin/users/${selectedId.value}`, { method: 'DELETE' })
    showDeleteUI.value = false
    back()
    await loadUsers()
  } catch (e) {
    deleteError.value = e.message || 'Delete failed'
  } finally {
    deleting.value = false
  }
}

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return users.value
  return users.value.filter(u =>
    (u.email || '').toLowerCase().includes(q) ||
    (u.firstName || '').toLowerCase().includes(q) ||
    (u.lastName  || '').toLowerCase().includes(q)
  )
})

async function loadUsers() {
  loading.value = true
  error.value = ''
  try {
    users.value = await apiFetch('/api/admin/users')
  } catch (e) {
    error.value = e.message || 'Failed to load users'
  } finally {
    loading.value = false
  }
}

async function openUser(u) {
  selectedId.value = u.userId
  detail.value = null
  detailError.value = ''
  detailLoading.value = true
  view.value = 'dashboard'
  auditByChatId.value = {}
  chatViewMode.value = {}
  roleMessage.value = ''
  roleError.value = ''
  try {
    detail.value = await apiFetch(`/api/admin/users/${u.userId}`)
  } catch (e) {
    detailError.value = e.message || 'Failed to load user details'
  } finally {
    detailLoading.value = false
  }
}

function back() {
  selectedId.value = null
  detail.value = null
  expandedChatId.value = null
  showDeleteUI.value = false
  auditByChatId.value = {}
  view.value = 'dashboard'
}

// Date-only — used for fields stored as `date` (YYYY-MM-DD, e.g. entries' day,
// reflections' month). Time is meaningless for these.
function fmtDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }
  catch { return iso }
}
// Date + time — used for every `created_at` / `updated_at` timestamp shown to
// the admin. A single calendar date can contain hundreds of rows (any fuzzer
// burst will demonstrate that), so admins need second-precision to tell rows
// apart and reconstruct a timeline.
function fmtDateTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch { return iso }
}

const counts = computed(() => ({
  goals:         detail.value?.goals?.length         || 0,
  entries:       detail.value?.entries?.length       || 0,
  conversations: detail.value?.conversations?.length || 0,
  reflections:   detail.value?.reflections?.length   || 0,
  programs:      detail.value?.programs?.length      || 0,
}))

const sectionTitles = {
  goals:       'Goals',
  entries:     'Journal entries',
  chats:       'LC chats',
  reflections: 'Reflections',
  programs:    'Programs',
}

onMounted(loadUsers)
</script>

<template>
  <section>
    <!-- ── User list ───────────────────────────────────────────────────── -->
    <div v-if="!selectedId" class="rounded-2xl bg-white border border-slate-200 shadow-sm">
      <div class="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
        <h2 class="text-base font-bold text-slate-800 flex-1">All users</h2>
        <input
          v-model="filter"
          type="search"
          placeholder="Search…"
          class="rounded-xl border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 w-48"
        />
      </div>

      <div v-if="loading" class="px-5 py-6 text-sm text-slate-500">Loading users…</div>
      <div v-else-if="error" class="px-5 py-4 flex items-start gap-2 text-sm text-rose-700 bg-rose-50">
        <AlertTriangle class="h-4 w-4 mt-0.5 shrink-0" />
        <span>{{ error }}</span>
      </div>
      <div v-else-if="!filtered.length" class="px-5 py-6 text-sm text-slate-500">
        {{ filter ? 'No users match that search.' : 'No users yet.' }}
      </div>

      <ul v-else class="divide-y divide-slate-100">
        <li
          v-for="u in filtered"
          :key="u.userId"
          class="px-5 py-3 flex items-center gap-3 hover:bg-slate-50 cursor-pointer transition-colors"
          @click="openUser(u)"
        >
          <div class="h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
               style="background:linear-gradient(135deg,#0d5f6b,#2dd4bf)">
            {{ ((u.firstName || u.email || '?')[0] || '?').toUpperCase() }}
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-slate-800 truncate">
              {{ u.firstName ? `${u.firstName}${u.lastName ? ' ' + u.lastName : ''}` : u.email }}
            </p>
            <p class="text-xs text-slate-500 truncate">{{ u.email }}</p>
          </div>
          <div class="text-right text-xs text-slate-500 space-y-0.5 hidden sm:block">
            <p><span class="font-semibold text-slate-700">{{ u.counts?.entries ?? 0 }}</span> entries</p>
            <p><span class="font-semibold text-slate-700">{{ u.counts?.goals ?? 0 }}</span> goals · <span class="font-semibold text-slate-700">{{ u.counts?.programs ?? 0 }}</span> programs</p>
          </div>
          <span v-if="u.role === 'admin'"
                class="ml-2 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md"
                style="background:rgba(13,95,107,0.1);color:#0d5f6b">admin</span>
          <ChevronRight class="h-4 w-4 text-slate-400 shrink-0" />
        </li>
      </ul>
    </div>

    <!-- ── User detail (dashboard + sub-pages) ─────────────────────────── -->
    <div v-else class="rounded-2xl bg-white border border-slate-200 shadow-sm">
      <div class="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
        <button v-if="view !== 'dashboard'" @click="backToDashboard"
                class="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft class="h-4 w-4" /> Dashboard
        </button>
        <button v-else @click="back"
                class="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft class="h-4 w-4" /> All users
        </button>
        <h2 class="text-base font-bold text-slate-800 flex-1 text-center">
          {{ view === 'dashboard' ? 'User detail' : sectionTitles[view] }}
        </h2>
        <div class="w-20" />
      </div>

      <div v-if="detailLoading" class="px-5 py-6 text-sm text-slate-500">Loading…</div>
      <div v-else-if="detailError" class="px-5 py-4 flex items-start gap-2 text-sm text-rose-700 bg-rose-50">
        <AlertTriangle class="h-4 w-4 mt-0.5 shrink-0" />
        <span>{{ detailError }}</span>
      </div>

      <!-- ── Dashboard view ──────────────────────────────────────────── -->
      <div v-else-if="detail && view === 'dashboard'" class="px-5 py-5 space-y-6">
        <!-- Profile + role -->
        <div>
          <p class="text-sm font-semibold text-slate-800 mb-1">
            {{ detail.profile?.firstName
                ? `${detail.profile.firstName}${detail.profile.lastName ? ' ' + detail.profile.lastName : ''}`
                : detail.email }}
          </p>
          <p class="text-xs text-slate-500">{{ detail.email }}</p>
          <p class="text-xs text-slate-500 mt-1">
            Joined {{ fmtDateTime(detail.createdAt) }} · Role: <span class="font-semibold text-slate-700">{{ detail.profile?.role || 'user' }}</span>
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <button
              v-if="(detail.profile?.role || 'user') !== 'admin'"
              @click="setRole('admin')"
              :disabled="roleSaving"
              class="inline-flex items-center gap-2 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 transition"
            >
              <ShieldCheck class="h-3.5 w-3.5" /> Promote to admin
            </button>
            <button
              v-else
              @click="setRole('user')"
              :disabled="roleSaving"
              class="inline-flex items-center gap-2 rounded-xl bg-slate-600 hover:bg-slate-700 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 transition"
            >
              <ShieldOff class="h-3.5 w-3.5" /> Demote to user
            </button>
            <span v-if="roleMessage" class="text-xs text-slate-600">{{ roleMessage }}</span>
            <span v-if="roleError" class="text-xs text-rose-600 flex items-center gap-1">
              <AlertTriangle class="h-3 w-3" /> {{ roleError }}
            </span>
          </div>
        </div>

        <!-- Activity tiles -->
        <section>
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Activity</h3>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <button @click="openSection('goals')"
                    class="text-left rounded-xl border border-slate-200 hover:border-teal-400 hover:shadow-sm bg-white p-3 transition">
              <div class="flex items-center gap-2 text-slate-500 text-xs">
                <Target class="h-3.5 w-3.5" /> Goals
              </div>
              <p class="text-2xl font-bold text-slate-800 mt-1">{{ counts.goals }}</p>
            </button>
            <button @click="openSection('entries')"
                    class="text-left rounded-xl border border-slate-200 hover:border-teal-400 hover:shadow-sm bg-white p-3 transition">
              <div class="flex items-center gap-2 text-slate-500 text-xs">
                <BookText class="h-3.5 w-3.5" /> Journal entries
              </div>
              <p class="text-2xl font-bold text-slate-800 mt-1">{{ counts.entries }}</p>
            </button>
            <button @click="openSection('chats')"
                    class="text-left rounded-xl border border-slate-200 hover:border-teal-400 hover:shadow-sm bg-white p-3 transition">
              <div class="flex items-center gap-2 text-slate-500 text-xs">
                <MessageSquare class="h-3.5 w-3.5" /> LC chats
              </div>
              <p class="text-2xl font-bold text-slate-800 mt-1">{{ counts.conversations }}</p>
            </button>
            <button @click="openSection('reflections')"
                    class="text-left rounded-xl border border-slate-200 hover:border-teal-400 hover:shadow-sm bg-white p-3 transition">
              <div class="flex items-center gap-2 text-slate-500 text-xs">
                <Sparkles class="h-3.5 w-3.5" /> Reflections
              </div>
              <p class="text-2xl font-bold text-slate-800 mt-1">{{ counts.reflections }}</p>
            </button>
            <button @click="openSection('programs')"
                    class="text-left rounded-xl border border-slate-200 hover:border-teal-400 hover:shadow-sm bg-white p-3 transition">
              <div class="flex items-center gap-2 text-slate-500 text-xs">
                <Layers class="h-3.5 w-3.5" /> Programs
              </div>
              <p class="text-2xl font-bold text-slate-800 mt-1">{{ counts.programs }}</p>
            </button>
          </div>
        </section>

        <!-- Danger zone -->
        <section class="pt-4 mt-2 border-t border-rose-100">
          <h3 class="text-xs font-bold uppercase tracking-wider text-rose-600 mb-2">Danger zone</h3>
          <div class="rounded-xl border border-rose-200 bg-rose-50 p-4">
            <p class="text-sm text-rose-800 font-semibold mb-1">Delete this user and everything they own</p>
            <p class="text-xs text-rose-700 mb-3">
              Removes the auth account, profile, journal entries, goals, programs,
              reflections, LC conversations, and pseudonym registry. Cannot be undone.
            </p>
            <button
              v-if="!showDeleteUI"
              @click="openDeleteUI"
              class="inline-flex items-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold px-3 py-2 transition"
            >
              <Trash2 class="h-4 w-4" />
              Delete user
            </button>
            <div v-else class="space-y-3">
              <label class="block text-xs font-semibold text-rose-800">
                Type <span class="font-mono">{{ detail.email }}</span> to confirm:
              </label>
              <input
                v-model="deleteConfirmTyping"
                type="text"
                autocomplete="off"
                :placeholder="detail.email"
                class="w-full rounded-xl border border-rose-300 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
              <div v-if="deleteError" class="flex items-start gap-2 text-sm text-rose-700">
                <AlertTriangle class="h-4 w-4 mt-0.5 shrink-0" />
                <span>{{ deleteError }}</span>
              </div>
              <div class="flex items-center gap-2">
                <button
                  @click="confirmDelete"
                  :disabled="deleting"
                  class="inline-flex items-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-sm font-semibold px-3 py-2 transition"
                >
                  <Trash2 class="h-4 w-4" />
                  {{ deleting ? 'Deleting…' : 'Confirm delete' }}
                </button>
                <button
                  @click="cancelDelete"
                  :disabled="deleting"
                  class="text-sm font-medium text-slate-600 hover:text-slate-900 px-3 py-2"
                >Cancel</button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- ── Goals sub-page ──────────────────────────────────────────── -->
      <div v-else-if="detail && view === 'goals'" class="px-5 py-5">
        <p v-if="!detail.goals?.length" class="text-xs text-slate-400">No goals.</p>
        <ul v-else class="space-y-2">
          <li v-for="g in detail.goals" :key="g.id" class="rounded-xl bg-slate-50 px-3 py-2 text-sm">
            <p class="font-semibold text-slate-800">{{ g.title }}</p>
            <p v-if="g.description" class="text-xs text-slate-600 mt-0.5 line-clamp-2">{{ g.description }}</p>
            <p class="text-xs text-slate-500 mt-1">
              {{ g.status }} · {{ g.progress ?? 0 }}% · {{ g.month }}
              · created {{ fmtDateTime(g.createdAt) }}
            </p>
          </li>
        </ul>
      </div>

      <!-- ── Entries sub-page ────────────────────────────────────────── -->
      <div v-else-if="detail && view === 'entries'" class="px-5 py-5">
        <p v-if="!detail.entries?.length" class="text-xs text-slate-400">No entries.</p>
        <ul v-else class="space-y-2">
          <li v-for="e in detail.entries" :key="e.id" class="rounded-xl bg-slate-50 px-3 py-2 text-sm">
            <p class="text-xs text-slate-500 mb-1">
              {{ fmtDateTime(e.createdAt) }} · day: {{ fmtDate(e.date) }} · {{ e.type }}
            </p>
            <p class="text-slate-800 whitespace-pre-wrap">{{ e.text }}</p>
            <p v-if="e.wins?.length" class="text-xs mt-1 text-emerald-600">{{ e.wins.length }} win{{ e.wins.length === 1 ? '' : 's' }} extracted</p>
          </li>
        </ul>
      </div>

      <!-- ── Chats sub-page (with side-by-side audit toggle, unchanged) -->
      <div v-else-if="detail && view === 'chats'" class="px-5 py-5">
        <p v-if="!detail.conversations?.length" class="text-xs text-slate-400">No chats.</p>
        <ul v-else class="space-y-2">
          <li v-for="c in detail.conversations" :key="c.id" class="rounded-xl bg-slate-50">
            <button
              @click="toggleChat(c.id)"
              class="w-full px-3 py-2 flex items-center gap-3 text-left hover:bg-slate-100 rounded-xl transition-colors"
            >
              <MessageSquare class="h-4 w-4 text-slate-400 shrink-0" />
              <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-slate-800 truncate">{{ c.title }}</p>
                <p class="text-xs text-slate-500">
                  {{ c.messageCount }} message{{ c.messageCount === 1 ? '' : 's' }}
                  · created {{ fmtDateTime(c.createdAt) }}
                  · updated {{ fmtDateTime(c.updatedAt) }}
                </p>
              </div>
              <ChevronRight class="h-4 w-4 text-slate-400 transition-transform" :class="{ 'rotate-90': expandedChatId === c.id }" />
            </button>
            <div v-if="expandedChatId === c.id" class="px-3 pb-3 space-y-2">
              <div class="flex items-center gap-1.5 pt-1 pb-2 border-b border-slate-200">
                <button
                  @click="setChatView(c.id, 'real')"
                  class="px-2 py-1 rounded-md text-[11px] font-semibold transition-colors"
                  :class="(chatViewMode[c.id] || 'real') === 'real' ? 'bg-slate-200 text-slate-800' : 'text-slate-500 hover:text-slate-700'"
                >Real text</button>
                <button
                  @click="setChatView(c.id, 'sidebyside'); loadAuditForChat(c.id)"
                  class="px-2 py-1 rounded-md text-[11px] font-semibold transition-colors flex items-center gap-1"
                  :class="chatViewMode[c.id] === 'sidebyside' ? 'bg-slate-200 text-slate-800' : 'text-slate-500 hover:text-slate-700'"
                >
                  <Eye class="h-3 w-3" /> Side-by-side (pseudonymized)
                </button>
              </div>

              <template v-if="(chatViewMode[c.id] || 'real') === 'real'">
                <div v-if="!c.messages?.length" class="text-xs text-slate-400 italic">Empty chat.</div>
                <div
                  v-for="(m, idx) in c.messages"
                  :key="idx"
                  class="rounded-lg px-3 py-2 text-sm"
                  :class="m.role === 'user' ? 'bg-white border border-slate-200' : 'bg-teal-50 border border-teal-100'"
                >
                  <p class="text-[10px] font-bold uppercase tracking-wider mb-1"
                     :class="m.role === 'user' ? 'text-slate-500' : 'text-teal-600'">
                    {{ m.role === 'user' ? 'User' : 'LC' }}
                  </p>
                  <p class="text-slate-800 whitespace-pre-wrap">{{ m.content }}</p>
                </div>
              </template>

              <template v-else>
                <div v-if="auditByChatId[c.id]?.loading" class="text-xs text-slate-400">Loading audit…</div>
                <div v-else-if="auditByChatId[c.id]?.error" class="text-xs text-rose-600">{{ auditByChatId[c.id].error }}</div>
                <div v-else-if="!auditByChatId[c.id]?.turns?.length" class="text-xs text-slate-400 italic">
                  No audit records for this chat (predates audit capture, or never sent through gateway).
                </div>
                <div v-else class="space-y-3">
                  <p class="text-[11px] text-slate-500 italic">
                    Left: what the user/LC saw. Right: what was sent to the LLM provider.
                    Pseudonyms (Person_XXXX, Org_XXXX, Loc_XXXX) are stable per-user identifiers.
                  </p>
                  <div v-for="t in auditByChatId[c.id].turns" :key="t.turn_index" class="space-y-1.5">
                    <div class="text-[10px] uppercase tracking-wider text-slate-400">Turn {{ t.turn_index }} — {{ fmtDateTime(t.created_at) }}</div>
                    <div class="grid grid-cols-2 gap-2">
                      <div class="rounded-lg bg-white border border-slate-200 px-2.5 py-2">
                        <p class="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">User (real)</p>
                        <p class="text-xs text-slate-800 whitespace-pre-wrap">{{ t.real_user_text }}</p>
                      </div>
                      <div class="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2">
                        <p class="text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-1">User → LLM (pseudonymized)</p>
                        <p class="text-xs text-slate-800 whitespace-pre-wrap font-mono">{{ t.pseudo_user_text }}</p>
                      </div>
                      <div class="rounded-lg bg-teal-50 border border-teal-100 px-2.5 py-2">
                        <p class="text-[10px] font-bold uppercase tracking-wider text-teal-600 mb-1">LC (real)</p>
                        <p class="text-xs text-slate-800 whitespace-pre-wrap">{{ t.real_assistant_text }}</p>
                      </div>
                      <div class="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2">
                        <p class="text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-1">LC → LLM (pseudonymized)</p>
                        <p class="text-xs text-slate-800 whitespace-pre-wrap font-mono">{{ t.pseudo_assistant_text }}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </li>
        </ul>
      </div>

      <!-- ── Reflections sub-page ────────────────────────────────────── -->
      <div v-else-if="detail && view === 'reflections'" class="px-5 py-5">
        <p v-if="!detail.reflections?.length" class="text-xs text-slate-400">No reflections.</p>
        <ul v-else class="space-y-2">
          <li v-for="r in detail.reflections" :key="r.id" class="rounded-xl bg-slate-50 px-3 py-2 text-sm">
            <p class="text-xs text-slate-500 mb-1">
              month: {{ r.month }} · generated {{ fmtDateTime(r.createdAt) }}
            </p>
            <p class="text-slate-800 whitespace-pre-wrap">{{ r.evaluation }}</p>
            <p v-if="r.suggestions" class="text-xs text-slate-600 mt-1 whitespace-pre-wrap">{{ r.suggestions }}</p>
          </li>
        </ul>
      </div>

      <!-- ── Programs sub-page ───────────────────────────────────────── -->
      <div v-else-if="detail && view === 'programs'" class="px-5 py-5">
        <p v-if="!detail.programs?.length" class="text-xs text-slate-400">No programs.</p>
        <ul v-else class="space-y-2">
          <li v-for="p in detail.programs" :key="p.id" class="rounded-xl bg-slate-50 px-3 py-2 text-sm">
            <p class="font-semibold text-slate-800">{{ p.name }}</p>
            <p v-if="p.description" class="text-xs text-slate-600 mt-0.5 line-clamp-2">{{ p.description }}</p>
            <p class="text-xs text-slate-500 mt-1">
              {{ p.status }} · {{ p.learnerCount ?? 0 }} learners
              · created {{ fmtDateTime(p.createdAt) }}
              <span v-if="p.updatedAt"> · updated {{ fmtDateTime(p.updatedAt) }}</span>
            </p>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
