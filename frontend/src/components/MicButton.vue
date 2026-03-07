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
    class="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-all duration-200 hover:scale-105 active:scale-95"
    :class="[
      listening
        ? 'border-[#0d5f6b] bg-gradient-to-br from-[#0d5f6b] to-[#0a4a54] text-white shadow-lg shadow-[#0d5f6b]/30'
        : supported
          ? 'border-slate-300/60 bg-white/80 text-slate-500 hover:border-[#0d5f6b]/40 hover:bg-teal-50 hover:text-[#0d5f6b] shadow-sm hover:shadow-md'
          : 'border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed',
    ]"
  >
    <span v-if="listening" class="absolute inset-0 rounded-xl bg-[#0d5f6b] animate-ping opacity-30"></span>
    <svg class="relative h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z"/>
    </svg>
  </button>
</template>
