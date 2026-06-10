<script setup>
import { ref, onMounted } from 'vue'
import { useApi } from '../../composables/useApi.js'
import { Save, AlertTriangle } from 'lucide-vue-next'

const { apiFetch } = useApi()

const loading = ref(true)
const saving  = ref(false)
const error   = ref('')
const saved   = ref(false)

const form = ref({
  baseUrl:      '',
  chatModel:    '',
  summaryModel: '',
  apiKey:       '',          // write-only — server never echoes back
  temperature:  0.4,
  maxTokens:    1024,
})
const hasKeyOnServer = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const cfg = await apiFetch('/api/admin/llm-config')
    form.value.baseUrl      = cfg.baseUrl      || ''
    form.value.chatModel    = cfg.chatModel    || ''
    form.value.summaryModel = cfg.summaryModel || ''
    form.value.temperature  = typeof cfg.temperature === 'number' ? cfg.temperature : 0.4
    form.value.maxTokens    = typeof cfg.maxTokens === 'number' ? cfg.maxTokens : 1024
    hasKeyOnServer.value    = !!cfg.hasApiKey
  } catch (e) {
    error.value = e.message || 'Failed to load LLM config'
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  error.value = ''
  saved.value = false
  try {
    const body = {
      baseUrl:      form.value.baseUrl.trim()      || null,
      chatModel:    form.value.chatModel.trim()    || null,
      summaryModel: form.value.summaryModel.trim() || null,
      temperature:  Number(form.value.temperature),
      maxTokens:    Number(form.value.maxTokens),
    }
    if (form.value.apiKey.trim()) body.apiKey = form.value.apiKey.trim()
    await apiFetch('/api/admin/llm-config', {
      method: 'PUT',
      body:   JSON.stringify(body),
    })
    form.value.apiKey = ''
    saved.value = true
    await load()
    setTimeout(() => { saved.value = false }, 2500)
  } catch (e) {
    error.value = e.message || 'Failed to save LLM config'
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <section>
    <div class="rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
      <h2 class="text-lg font-bold text-slate-800 mb-1">Active provider configuration</h2>
      <p class="text-xs text-slate-500 mb-6">
        Any Anthropic-compatible endpoint works (Anthropic direct, DeepSeek, etc.).
        Leave base URL blank to use Anthropic's default. Changes apply immediately on save.
      </p>

      <div v-if="loading" class="text-sm text-slate-500">Loading…</div>

      <div v-else class="space-y-5">
        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1.5">Base URL</label>
          <input
            v-model="form.baseUrl"
            type="url"
            placeholder="https://api.anthropic.com  (leave blank for default)"
            class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1.5">Chat model</label>
            <input
              v-model="form.chatModel"
              type="text"
              placeholder="e.g. claude-haiku-4-5-20251001"
              class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1.5">Summary model</label>
            <input
              v-model="form.summaryModel"
              type="text"
              placeholder="e.g. claude-haiku-4-5-20251001"
              class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1.5">Temperature</label>
            <input
              v-model.number="form.temperature"
              type="number" min="0" max="1" step="0.05"
              class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1.5">Max tokens</label>
            <input
              v-model.number="form.maxTokens"
              type="number" min="64" max="8192" step="64"
              class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1.5">
            API key
            <span v-if="hasKeyOnServer" class="ml-2 text-emerald-600 font-normal">(a key is currently stored)</span>
            <span v-else class="ml-2 text-amber-600 font-normal">(no key stored)</span>
          </label>
          <input
            v-model="form.apiKey"
            type="password"
            autocomplete="off"
            :placeholder="hasKeyOnServer ? 'Leave blank to keep the existing key' : 'Paste the API key for the provider above'"
            class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
          />
          <p class="mt-1.5 text-[11px] text-slate-500">
            Stored encrypted at rest. Never echoed back to this form once saved.
          </p>
        </div>

        <div v-if="error" class="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">
          <AlertTriangle class="h-4 w-4 mt-0.5 shrink-0" />
          <span>{{ error }}</span>
        </div>

        <div class="flex items-center gap-3 pt-2">
          <button
            @click="save"
            :disabled="saving"
            class="btn btn-primary inline-flex items-center gap-2"
          >
            <Save class="h-4 w-4" />
            {{ saving ? 'Saving…' : 'Save changes' }}
          </button>
          <span v-if="saved" class="text-sm text-emerald-600 font-medium">Saved.</span>
        </div>
      </div>
    </div>
  </section>
</template>
