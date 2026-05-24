<script setup>
import {
  CheckCircle2, AlertCircle, Plus, TrendingUp, Trash2, Trophy, ArrowRight, Layers,
} from 'lucide-vue-next'
import { actionColor, actionDoneLabel, actionPendingLabel } from '../composables/useLcChat.js'

const props = defineProps({
  action:  { type: Object, required: true },
  density: { type: String, default: 'compact' },   // 'compact' | 'roomy'
})
const emit = defineEmits(['navigate'])

function actionIcon(type) {
  if (type === 'create_goal')    return Plus
  if (type === 'update_goal')    return TrendingUp
  if (type === 'delete_goal')    return Trash2
  if (type === 'log_win')        return Trophy
  if (type === 'create_program') return Layers
  if (type === 'navigate')       return ArrowRight
  return CheckCircle2
}
</script>

<template>
  <div
    class="rounded-xl border"
    :class="[actionColor(action.type).bg, actionColor(action.type).border, density === 'compact' ? 'px-3 py-2' : 'px-3 py-2.5']"
  >
    <div class="flex items-center gap-2" :class="density === 'compact' ? 'text-[12px]' : 'text-xs'">
      <span
        v-if="action._state === 'pending'"
        class="h-3.5 w-3.5 rounded-full border-2 border-current opacity-70 animate-spin shrink-0"
        :class="actionColor(action.type).icon"
      />
      <CheckCircle2 v-else-if="action._state === 'done'"  class="h-4 w-4 shrink-0" :class="actionColor(action.type).icon" />
      <AlertCircle  v-else-if="action._state === 'error'" class="h-4 w-4 shrink-0 text-rose-500" />
      <component    v-else :is="actionIcon(action.type)"  class="h-4 w-4 shrink-0" :class="actionColor(action.type).icon" />

      <span v-if="action._state === 'pending'" class="font-semibold text-slate-700 flex-1 min-w-0 truncate">{{ actionPendingLabel(action) }}</span>
      <span v-else-if="action._state === 'done'"  class="font-semibold text-slate-800 flex-1 min-w-0 truncate">{{ actionDoneLabel(action) }}</span>
      <span v-else-if="action._state === 'error'" class="font-semibold text-rose-700 flex-1 min-w-0 truncate">{{ action._error }}</span>

      <!-- Navigate is the only user-click action -->
      <button
        v-else-if="action.type === 'navigate'"
        type="button"
        :aria-label="action.label || 'Go'"
        @click="emit('navigate')"
        class="ml-auto text-[11px] font-bold rounded-lg px-2.5 py-1 bg-white border transition hover:shadow-sm"
        :class="actionColor(action.type).border"
      >{{ action.label || 'Go' }} →</button>
    </div>

    <!-- Fuzzy-match transparency. Shown only when the resolver had to translate
         a natural-language reference into a real goal. Tells the user
         "I matched what you said to this specific goal" so it's never opaque. -->
    <p
      v-if="action._match && action._state !== 'error'"
      class="mt-1 ml-6 text-[10px] italic text-slate-500"
      :title="`Match confidence: ${action._match.confidence}`"
    >
      matched <span class="text-slate-600">"{{ action._match.from }}"</span>
      → <span class="font-semibold text-slate-700">"{{ action._match.to }}"</span>
    </p>
  </div>
</template>
