<script setup>
import { ref, onMounted, computed } from 'vue'
import { useApi } from '../../composables/useApi.js'
import { ChevronRight, ArrowLeft, AlertTriangle, Trash2, MessageSquare } from 'lucide-vue-next'

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
function toggleChat(id) { expandedChatId.value = expandedChatId.value === id ? null : id }

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
        <!-- Profile -->
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
        </div>

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
