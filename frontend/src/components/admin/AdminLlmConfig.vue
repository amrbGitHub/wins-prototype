<script setup>
import { ref, computed, onMounted } from 'vue'
import { useApi } from '../../composables/useApi.js'
import { Save, AlertTriangle, Check, X as XIcon } from 'lucide-vue-next'

const { apiFetch } = useApi()

const loading = ref(true)
const saving  = ref(false)
const error   = ref('')
const saved   = ref(false)

const form = ref({
  providerType: 'anthropic',
  baseUrl:      '',
  chatModel:    '',
  summaryModel: '',
  apiKey:       '',
  temperature:  0.4,
  maxTokens:    1024,
})
const providers    = ref(['anthropic', 'openai', 'google'])
const keyStoredFor = ref({})       // { anthropic: bool, openai: bool, google: bool }

const PROVIDER_LABELS = {
  anthropic: 'Anthropic (or Anthropic-compatible: DeepSeek /anthropic, Bedrock, etc.)',
  openai:    'OpenAI (or OpenAI-compatible: Mistral, Together, Groq, Fireworks, vLLM, etc.)',
  google:    'Google Gemini',
}
const PROVIDER_PLACEHOLDERS = {
  anthropic: {
    chatModel:   'e.g. claude-haiku-4-5-20251001',
    baseUrl:     'https://api.anthropic.com  (leave blank for default)',
    apiKeyHelp:  'sk-ant-… from console.anthropic.com',
  },
  openai: {
    chatModel:   'e.g. gpt-4o-mini',
    baseUrl:     'https://api.openai.com/v1  (or e.g. https://api.mistral.ai/v1)',
    apiKeyHelp:  'sk-… from platform.openai.com (or your compatible provider)',
  },
  google: {
    chatModel:   'e.g. gemini-2.0-flash',
    baseUrl:     '(Gemini SDK ignores baseUrl)',
    apiKeyHelp:  'AIza… from aistudio.google.com/apikey',
  },
}
const placeholders = computed(() => PROVIDER_PLACEHOLDERS[form.value.providerType] || PROVIDER_PLACEHOLDERS.anthropic)
const baseUrlDisabled = computed(() => form.value.providerType === 'google')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const cfg = await apiFetch('/api/admin/llm-config')
    providers.value         = cfg.providers || ['anthropic', 'openai', 'google']
    keyStoredFor.value      = cfg.keyStoredFor || {}
    form.value.providerType = cfg.providerType || 'anthropic'
    form.value.baseUrl      = cfg.baseUrl      || ''
    form.value.chatModel    = cfg.chatModel    || ''
    form.value.summaryModel = cfg.summaryModel || ''
    form.value.temperature  = typeof cfg.temperature === 'number' ? cfg.temperature : 0.4
    form.value.maxTokens    = typeof cfg.maxTokens === 'number' ? cfg.maxTokens : 1024
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
      providerType: form.value.providerType,
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
        Pick a provider and point it at any endpoint of that family. Changes
        apply immediately on save. Keys are stored per provider, so you can
        switch back and forth without re-entering them.
      </p>

      <div class="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <span class="font-semibold">Model must support native tool calling.</span>
        LC uses tool calls to create goals, log wins, etc. Models without
        function-calling support (older Claude 2, GPT-3.5, base Llama, most
        local models under ~7B) will not work for the chat model. Reasoning
        models work but are slower and costlier per turn.
      </div>

      <div v-if="loading" class="text-sm text-slate-500">Loading…</div>

      <div v-else class="space-y-5">
        <!-- Provider -->
        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1.5">Provider</label>
          <select
            v-model="form.providerType"
            class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
          >
            <option v-for="p in providers" :key="p" :value="p">{{ PROVIDER_LABELS[p] || p }}</option>
          </select>
          <div class="mt-2 flex flex-wrap gap-3 text-[11px]">
            <span v-for="p in providers" :key="p" class="inline-flex items-center gap-1">
              <Check v-if="keyStoredFor[p]" class="h-3 w-3 text-emerald-600" />
              <XIcon v-else class="h-3 w-3 text-slate-400" />
              <span :class="keyStoredFor[p] ? 'text-emerald-700' : 'text-slate-400'">
                {{ p }} key {{ keyStoredFor[p] ? 'stored' : 'missing' }}
              </span>
            </span>
          </div>
        </div>

        <!-- Base URL -->
        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1.5">Base URL</label>
          <input
            v-model="form.baseUrl"
            type="url"
            :disabled="baseUrlDisabled"
            :placeholder="placeholders.baseUrl"
            class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </div>

        <!-- Models -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1.5">Chat model</label>
            <input
              v-model="form.chatModel"
              type="text"
              :placeholder="placeholders.chatModel"
              class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1.5">Fast model (summaries + analyzers)</label>
            <input
              v-model="form.summaryModel"
              type="text"
              :placeholder="placeholders.chatModel"
              class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <p class="mt-1 text-xs text-slate-500">Used for win/goal/reflection scoring, conversation titles, and the summary updater. Leave blank to fall back to the chat model.</p>
          </div>
        </div>

        <!-- Sampling -->
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

        <!-- API key -->
        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1.5">
            API key for <span class="font-mono">{{ form.providerType }}</span>
            <span v-if="keyStoredFor[form.providerType]" class="ml-2 text-emerald-600 font-normal">(stored)</span>
            <span v-else class="ml-2 text-amber-600 font-normal">(none stored)</span>
          </label>
          <input
            v-model="form.apiKey"
            type="password"
            autocomplete="off"
            :placeholder="keyStoredFor[form.providerType] ? 'Leave blank to keep the existing key' : placeholders.apiKeyHelp"
            class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
          />
          <p class="mt-1.5 text-[11px] text-slate-500">
            Stored encrypted at rest. Never echoed back. Each provider has its own key slot.
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
