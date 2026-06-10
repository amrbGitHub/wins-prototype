<script setup>
import { ref } from 'vue'
import { Shield, Cpu, Users } from 'lucide-vue-next'
import AdminLlmConfig    from './admin/AdminLlmConfig.vue'
import AdminUserInspector from './admin/AdminUserInspector.vue'

const tab = ref('llm')
const tabs = [
  { id: 'llm',   label: 'LLM Provider', icon: Cpu },
  { id: 'users', label: 'Users',        icon: Users },
]
</script>

<template>
  <main class="flex-1 px-4 sm:px-8 py-6 sm:py-10 max-w-5xl mx-auto w-full">
    <header class="mb-8">
      <div class="flex items-center gap-3 mb-2">
        <div class="h-10 w-10 rounded-2xl flex items-center justify-center"
             style="background:linear-gradient(135deg,#0d5f6b,#0ea5e9)">
          <Shield class="h-5 w-5 text-white" />
        </div>
        <h1 class="text-2xl font-bold text-slate-800">Admin</h1>
      </div>
      <p class="text-sm text-slate-500">
        Configure the LLM provider for the whole app, and inspect user data.
      </p>
    </header>

    <div class="flex gap-1 mb-6 border-b border-slate-200">
      <button
        v-for="t in tabs"
        :key="t.id"
        @click="tab = t.id"
        class="flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors -mb-px border-b-2"
        :class="tab === t.id
          ? 'text-teal-700 border-teal-500'
          : 'text-slate-500 border-transparent hover:text-slate-700'"
      >
        <component :is="t.icon" class="h-4 w-4" />
        {{ t.label }}
      </button>
    </div>

    <AdminLlmConfig    v-if="tab === 'llm'" />
    <AdminUserInspector v-else-if="tab === 'users'" />
  </main>
</template>
