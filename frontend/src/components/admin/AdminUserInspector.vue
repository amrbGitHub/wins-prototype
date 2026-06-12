<script setup>
import { ref, onMounted, computed } from 'vue'
import { useApi } from '../../composables/useApi.js'
import { ChevronRight, ArrowLeft, AlertTriangle, Trash2, MessageSquare, ShieldCheck, ShieldOff, BarChart3, Eye } from 'lucide-vue-next'

const { apiFetch } = useApi()

const users   = ref([])
const loading = ref(true)
const error   = ref('')
const filter  = ref('')

const selectedId    = ref(null)
const detail        = ref(null)
const detailLoading = ref(false)
const detailError   = ref('')

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
    // Refresh list so the admin chip updates.
    loadUsers()
  } catch (e) {
    roleError.value = e.message || 'Role change failed'
  } finally {
    roleSaving.value = false
  }
}

// ── LLM usage panel ─────────────────────────────────────────────────────────
const usage = ref(null)
const usageLoading = ref(false)
const usageError   = ref('')
async function loadUsage() {
  if (!selectedId.value) return
  usageLoading.value = true
  usageError.value = ''
  try {
    usage.value = await apiFetch(`/api/admin/users/${selectedId.value}/usage`)
  } catch (e) {
    usageError.value = e.message || 'Failed to load usage'
  } finally {
    usageLoading.value = false
  }
}
function fmtTokens(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}

// ── Audit (pseudonymized side-by-side) ─────────────────────────────────────
const auditByChatId = ref({})       // { [conversationId]: { loading, error, turns } }
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
const chatViewMode = ref({})  // per-chatId: 'real' | 'sidebyside'
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
  usage.value = null
  auditByChatId.value = {}
  chatViewMode.value = {}
  roleMessage.value = ''
  roleError.value = ''
  try {
    detail.value = await apiFetch(`/api/admin/users/${u.userId}`)
    loadUsage()  // fetch in parallel; the panel renders independently
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
  usage.value = null
  auditByChatId.value = {}
}

function fmtDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }
  catch { return iso }
}

onMounted(loadUsers)
</script>

<template>
  <section>
    <!-- ── List ─────────────────────────────────────────────────────────── -->
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

    <!-- ── Detail ───────────────────────────────────────────────────────── -->
    <div v-else class="rounded-2xl bg-white border border-slate-200 shadow-sm">
      <div class="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
        <button @click="back" class="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft class="h-4 w-4" />
          Back
        </button>
        <h2 class="text-base font-bold text-slate-800 flex-1 text-center">User detail</h2>
        <div class="w-12" />
      </div>

      <div v-if="detailLoading" class="px-5 py-6 text-sm text-slate-500">Loading…</div>
      <div v-else-if="detailError" class="px-5 py-4 flex items-start gap-2 text-sm text-rose-700 bg-rose-50">
        <AlertTriangle class="h-4 w-4 mt-0.5 shrink-0" />
        <span>{{ detailError }}</span>
      </div>

      <div v-else-if="detail" class="px-5 py-5 space-y-6">
        <!-- Profile + role controls -->
        <div>
          <p class="text-sm font-semibold text-slate-800 mb-1">
            {{ detail.profile?.firstName
                ? `${detail.profile.firstName}${detail.profile.lastName ? ' ' + detail.profile.lastName : ''}`
                : detail.email }}
          </p>
          <p class="text-xs text-slate-500">{{ detail.email }}</p>
          <p class="text-xs text-slate-500 mt-1">
            Joined {{ fmtDate(detail.createdAt) }} · Role: <span class="font-semibold text-slate-700">{{ detail.profile?.role || 'user' }}</span>
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

        <!-- LLM usage (last 30 days) -->
        <section>
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
            <BarChart3 class="h-3.5 w-3.5" /> LLM usage (last 30 days)
          </h3>
          <div v-if="usageLoading" class="text-xs text-slate-400">Loading usage…</div>
          <div v-else-if="usageError" class="text-xs text-rose-600">{{ usageError }}</div>
          <div v-else-if="usage" class="rounded-xl bg-slate-50 px-3 py-3 text-sm space-y-3">
            <div class="grid grid-cols-3 gap-3">
              <div>
                <p class="text-[10px] uppercase tracking-wider text-slate-500">Calls</p>
                <p class="text-lg font-bold text-slate-800">{{ usage.totals.calls }}</p>
              </div>
              <div>
                <p class="text-[10px] uppercase tracking-wider text-slate-500">Input</p>
                <p class="text-lg font-bold text-slate-800">{{ fmtTokens(usage.totals.input) }}</p>
              </div>
              <div>
                <p class="text-[10px] uppercase tracking-wider text-slate-500">Output</p>
                <p class="text-lg font-bold text-slate-800">{{ fmtTokens(usage.totals.output) }}</p>
              </div>
            </div>
            <div class="border-t border-slate-200 pt-2">
              <p class="text-[10px] uppercase tracking-wider text-slate-500 mb-1">By purpose</p>
              <div class="space-y-1">
                <div v-for="(v, k) in usage.byPurpose" :key="k" class="flex items-center justify-between text-xs">
                  <span class="font-medium text-slate-700 capitalize">{{ k }}</span>
                  <span class="text-slate-500">{{ v.calls }} calls · {{ fmtTokens(v.input) }} in · {{ fmtTokens(v.output) }} out</span>
                </div>
              </div>
            </div>
            <div v-if="usage.byModel?.length" class="border-t border-slate-200 pt-2">
              <p class="text-[10px] uppercase tracking-wider text-slate-500 mb-1">By model</p>
              <div class="space-y-1">
                <div v-for="m in usage.byModel" :key="m.provider + m.model" class="flex items-center justify-between text-xs">
                  <span class="font-mono text-slate-700">{{ m.provider }}/{{ m.model }}</span>
                  <span class="text-slate-500">{{ fmtTokens(m.input + m.output) }} tok</span>
                </div>
              </div>
            </div>
          </div>
          <p v-else class="text-xs text-slate-400">No usage data yet.</p>
        </section>

        <!-- Goals -->
        <section>
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Goals ({{ detail.goals?.length || 0 }})</h3>
          <ul v-if="detail.goals?.length" class="space-y-2">
            <li v-for="g in detail.goals" :key="g.id" class="rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <p class="font-semibold text-slate-800">{{ g.title }}</p>
              <p class="text-xs text-slate-500">{{ g.status }} · {{ g.progress ?? 0 }}% · {{ g.month }}</p>
            </li>
          </ul>
          <p v-else class="text-xs text-slate-400">No goals.</p>
        </section>

        <!-- Programs -->
        <section>
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Programs ({{ detail.programs?.length || 0 }})</h3>
          <ul v-if="detail.programs?.length" class="space-y-2">
            <li v-for="p in detail.programs" :key="p.id" class="rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <p class="font-semibold text-slate-800">{{ p.name }}</p>
              <p class="text-xs text-slate-500">{{ p.status }}</p>
            </li>
          </ul>
          <p v-else class="text-xs text-slate-400">No programs.</p>
        </section>

        <!-- Entries -->
        <section>
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Journal entries ({{ detail.entries?.length || 0 }})</h3>
          <ul v-if="detail.entries?.length" class="space-y-2">
            <li v-for="e in detail.entries" :key="e.id" class="rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <p class="text-xs text-slate-500 mb-1">{{ fmtDate(e.date) }} · {{ e.type }}</p>
              <p class="text-slate-800 line-clamp-3">{{ e.text }}</p>
              <p v-if="e.wins?.length" class="text-xs mt-1 text-emerald-600">{{ e.wins.length }} win{{ e.wins.length === 1 ? '' : 's' }} extracted</p>
            </li>
          </ul>
          <p v-else class="text-xs text-slate-400">No entries.</p>
        </section>

        <!-- Reflections -->
        <section>
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Reflections ({{ detail.reflections?.length || 0 }})</h3>
          <ul v-if="detail.reflections?.length" class="space-y-2">
            <li v-for="r in detail.reflections" :key="r.id" class="rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <p class="text-xs text-slate-500 mb-1">{{ r.month }}</p>
              <p class="text-slate-800 line-clamp-4">{{ r.evaluation }}</p>
            </li>
          </ul>
          <p v-else class="text-xs text-slate-400">No reflections.</p>
        </section>

        <!-- LC chats -->
        <section>
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">LC chats ({{ detail.conversations?.length || 0 }})</h3>
          <ul v-if="detail.conversations?.length" class="space-y-2">
            <li v-for="c in detail.conversations" :key="c.id" class="rounded-xl bg-slate-50">
              <button
                @click="toggleChat(c.id)"
                class="w-full px-3 py-2 flex items-center gap-3 text-left hover:bg-slate-100 rounded-xl transition-colors"
              >
                <MessageSquare class="h-4 w-4 text-slate-400 shrink-0" />
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-semibold text-slate-800 truncate">{{ c.title }}</p>
                  <p class="text-xs text-slate-500">{{ c.messageCount }} message{{ c.messageCount === 1 ? '' : 's' }} · {{ fmtDate(c.updatedAt) }}</p>
                </div>
                <ChevronRight class="h-4 w-4 text-slate-400 transition-transform" :class="{ 'rotate-90': expandedChatId === c.id }" />
              </button>
              <div v-if="expandedChatId === c.id" class="px-3 pb-3 space-y-2">
                <!-- View toggle -->
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

                <!-- Real-text view (unchanged) -->
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

                <!-- Side-by-side audit view -->
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
                      <div class="text-[10px] uppercase tracking-wider text-slate-400">Turn {{ t.turn_index }} — {{ fmtDate(t.created_at) }}</div>
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
          <p v-else class="text-xs text-slate-400">No chats.</p>
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
    </div>
  </section>
</template>
