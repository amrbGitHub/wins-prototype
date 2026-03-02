<script setup>
defineProps({
  listening: Boolean,
  supported: Boolean,
})
defineEmits(['click'])
</script>

<template>
  <button
    type="button"
    @click="$emit('click')"
    :disabled="!supported"
    :title="!supported ? 'Voice input requires Chrome or Edge' : listening ? 'Stop recording' : 'Click to dictate'"
    class="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition"
    :class="[
      listening
        ? 'border-rose-400 bg-rose-500 text-white shadow-md'
        : supported
          ? 'border-slate-300 bg-white text-slate-500 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600'
          : 'border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed',
    ]"
  >
    <span v-if="listening" class="absolute inset-0 rounded-full bg-rose-400 animate-ping opacity-60"></span>
    <svg class="relative h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z"/>
    </svg>
  </button>
</template>
