<script setup>
// ProgramPicker — reusable dropdown for tagging an entity to a program.
//
// Usage:
//   <ProgramPicker v-model="form.programId" />
//   <ProgramPicker v-model="filter.programId" :include-none-filter="true" />
//
// Fetches active programs once on mount. Defaults to "No program" so the
// picker never forces a choice. When `includeNoneFilter` is true, a third
// option appears for filtering: "Untagged" (program_id IS NULL).

import { ref, onMounted, watch } from 'vue'
import { useApi } from '../composables/useApi.js'
import { Tag } from 'lucide-vue-next'

const props = defineProps({
  modelValue:        { type: String, default: null },          // programId | null | '__none__'
  includeNoneFilter: { type: Boolean, default: false },         // adds "Untagged" option for filter use
  placeholder:       { type: String, default: 'No program' },
  size:              { type: String, default: 'md' },           // 'sm' | 'md'
  disabled:          { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const { apiFetch } = useApi()
const programs = ref([])
const loading  = ref(true)

async function load() {
  loading.value = true
  try {
    // Show active + completed in the picker. Archived are hidden — user can
    // un-archive from the Programs page if they want to re-tag entries.
    const all = await apiFetch('/api/programs')
    programs.value = (all || []).filter(p => p.status !== 'archived')
  } catch (e) {
    console.error('[ProgramPicker] load failed:', e)
    programs.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)

// Expose a refresh so parent components can call it after creating a program inline
defineExpose({ refresh: load })

function onChange(ev) {
  const v = ev.target.value
  emit('update:modelValue', v === '' ? null : v)
}
</script>

<template>
  <label class="inline-flex items-center gap-2">
    <Tag class="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
    <select
      :value="modelValue ?? ''"
      :disabled="disabled || loading"
      @change="onChange"
      class="rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-200 disabled:opacity-50"
      :class="size === 'sm' ? 'text-xs px-2 py-1' : 'text-sm px-3 py-1.5'"
      :aria-label="includeNoneFilter ? 'Filter by program' : 'Tag a program'"
    >
      <option value="">{{ loading ? 'Loading…' : placeholder }}</option>
      <option v-if="includeNoneFilter" value="__none__">Untagged only</option>
      <option v-if="programs.length" disabled>──────────</option>
      <option v-for="p in programs" :key="p.id" :value="p.id">{{ p.name }}</option>
    </select>
  </label>
</template>
