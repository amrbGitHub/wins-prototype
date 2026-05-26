// useLcChat — shared state + behaviour for both LC entry points (Elsie.vue overlay
// and ElsiePage.vue full page). Owns:
//   - messages array + assistant message lifecycle
//   - SSE stream wrapper with inactivity watchdog + AbortController
//   - empty-response detection + retry-from-message
//   - 5 auto-executing actions (create_goal, update_goal, delete_goal, log_win, navigate)
//   - SpeechRecognition lifecycle (voice mode)
//   - Kokoro TTS with cancellable speak
//   - action presentation helpers
//
// What it does NOT own:
//   - chat persistence (each consumer wires its own save policy)
//   - text input ref / send button / mic orb (presentation only)

import { ref, computed, nextTick, onUnmounted } from 'vue'
import { useApi }   from './useApi.js'
import { useTTS }   from './useTTS.js'
import { useSTT }   from './useSTT.js'
import { todayLocal, thisMonthLocal } from '../lib/dates.js'

const WATCHDOG_MS = 60_000           // abort SSE if no chunk for this long

// ── action label/icon registry ────────────────────────────────────────────────
// Returned by helpers — consumers import their own icon components and look up by type
export const ACTION_TYPES = ['create_goal', 'update_goal', 'delete_goal', 'log_win', 'navigate']

export function actionColor(type) {
  if (type === 'create_goal')    return { icon: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' }
  if (type === 'update_goal')    return { icon: 'text-teal-600',    bg: 'bg-teal-50',    border: 'border-teal-200' }
  if (type === 'delete_goal')    return { icon: 'text-rose-600',    bg: 'bg-rose-50',    border: 'border-rose-200' }
  if (type === 'log_win')        return { icon: 'text-amber-600',   bg: 'bg-amber-50',   border: 'border-amber-200' }
  if (type === 'create_program') return { icon: 'text-cyan-600',    bg: 'bg-cyan-50',    border: 'border-cyan-200' }
  if (type === 'navigate')       return { icon: 'text-violet-600',  bg: 'bg-violet-50',  border: 'border-violet-200' }
  return                                { icon: 'text-slate-500',   bg: 'bg-slate-50',   border: 'border-slate-200' }
}

// Title helpers. Lifecycle:
//   - server resolver attaches `goalTitle` (the existing title)
//   - PATCH response (in `_result.title`) is the post-save title (== new for renames)
//   - `action.title` is the new title for renames, undefined otherwise
function existingGoalTitle(action) {
  return action._result?.title || action.goalTitle || action.title || ''
}
function newRenameTitle(action) {
  return action._result?.title || action.title || ''
}

export function actionDoneLabel(action) {
  if (action.type === 'create_goal')    return `Goal created: "${action._result?.title || action.title || ''}"`
  if (action.type === 'update_goal') {
    const fields = action._result?.fields || []
    if (fields.includes('title'))  return `Renamed to "${newRenameTitle(action)}"`
    if (fields.includes('status')) return `Goal marked ${action._result?.status || action.status || ''}: "${existingGoalTitle(action)}"`
    return `Progress updated: "${existingGoalTitle(action) || 'goal'}" → ${action._result?.progress ?? action.progress}%`
  }
  if (action.type === 'delete_goal')    return `Goal deleted: "${existingGoalTitle(action)}"`
  if (action.type === 'log_win')        return `Win logged: "${action._result?.title || action.title || ''}"`
  if (action.type === 'create_program') return `Program created: "${action._result?.name || action.name || ''}"`
  return 'Done'
}
export function actionPendingLabel(action) {
  if (action.type === 'create_goal') return `Creating goal: "${action.title || ''}"`
  if (action.type === 'update_goal') {
    if (action.title && action.title.trim() && action.progress === undefined && !action.status) {
      return `Renaming to "${action.title}"`
    }
    return `Updating "${action.goalTitle || 'goal'}"`
  }
  if (action.type === 'delete_goal')    return `Deleting goal: "${action.goalTitle || action.title || ''}"`
  if (action.type === 'log_win')        return `Logging win: "${action.title || ''}"`
  if (action.type === 'create_program') return `Creating program: "${action.name || ''}"`
  return 'Working…'
}

// ── core composable ──────────────────────────────────────────────────────────
export function useLcChat({ getFirstName, getConversationId, onGoalsUpdated, onNavigate, onAfterTurn } = {}) {
  const { apiStream, apiFetch } = useApi()
  const tts = useTTS()

  // ── state ──────────────────────────────────────────────────────────────────
  // messages shape:
  //   { _id, role: 'user'|'assistant', content, actions?, failed?, errorMsg? }
  const messages = ref([])
  const error    = ref('')
  const streaming = ref(false)
  const chatEl   = ref(null)            // text-mode scroll container ref

  // Voice mode — STT backend (native SR or Whisper WASM) is owned by useSTT.
  // useLcChat just orchestrates the user-facing state machine.
  const convoStatus     = ref('idle')   // idle | listening | processing | speaking
  const convoTranscript = ref('')

  const stt = useSTT({
    onText:  (text, isFinal) => {
      convoTranscript.value = text
      // We don't act on isFinal here — the manual-toggle flow processes the
      // turn in onEnd. isFinal is informational for the transcript display only.
    },
    onError: (msg) => {
      error.value = msg
      convoStatus.value = 'idle'
    },
    onEnd: async () => {
      const text = convoTranscript.value.trim()
      if (!text) { convoStatus.value = 'idle'; return }
      // Keep the transcript visible through processing + speaking so the user
      // can confirm what was captured. It's cleared by the next startConvoListening.
      messages.value.push({ _id: newId('m'), role: 'user', content: text })
      await runVoiceTurn()
    },
  })

  // ── derived ────────────────────────────────────────────────────────────────
  const lastAiMsg = computed(() => {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      if (messages.value[i].role === 'assistant') return messages.value[i].content
    }
    return ''
  })
  const lastActions = computed(() => {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      if (messages.value[i].role === 'assistant') return messages.value[i].actions ?? []
    }
    return []
  })
  const convoStatusLabel = computed(() => ({
    idle:       '',
    listening:  'Listening…',
    processing: 'Thinking…',
    speaking:   'Speaking…',
  }[convoStatus.value]))

  // ── helpers ────────────────────────────────────────────────────────────────
  function newId(prefix) {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
  function scrollBottom() {
    nextTick(() => { if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight })
  }

  function randomFrom(items) {
    return items[Math.floor(Math.random() * items.length)]
  }

  function buildGreeting() {
    const name = (getFirstName?.() || '').trim()
    const hey = name ? `Hey ${name}` : 'Hey'
    const options = [
          `${hey}! What can I do for you today?`,
          `${hey}! I am here whenever you want to update a goal, log a win, or talk something through.`,
          `${hey}! What would you like help with right now?`,
          `${hey}! Tell me what is going on, and I will help however I can.`,
          `${hey}! Want to update progress, capture a win, or just check in?`,
        ]
    return randomFrom(options)
  }

  async function addGreeting({ speak = false } = {}) {
    const greeting = buildGreeting()
    messages.value.push({
      _id: newId('m'),
      role: 'assistant',
      content: greeting,
      actions: [],
      failed: false,
    })
    scrollBottom()
    onAfterTurn?.()
    if (speak) {
      await speakAI(greeting)
      // Intentionally NOT auto-opening the mic here. The greeting is the FIRST
      // assistant message in a fresh chat — the user hasn't initiated anything
      // yet. Auto-opening felt pushy and forced users into a "thinking…" state
      // they had to manually cancel. They click the orb when they want to talk.
      // Subsequent AI replies (in runVoiceTurn) still auto-open the mic.
    }
    return greeting
  }

  // ── SSE call ───────────────────────────────────────────────────────────────
  async function callAPI(historyMessages, onDelta = null, signal = undefined) {
    let finalMessage = '', finalActions = [], serverFailed = false, serverErrorMsg = null, serverDropped = []
    for await (const chunk of apiStream('/api/elsie/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages:       historyMessages,
        firstName:      getFirstName?.() || '',
        conversationId: getConversationId?.() || null,   // gateway: link pseudonyms used this turn to this conversation
      }),
      signal,
    })) {
      if (chunk.error) throw new Error(chunk.error)
      if (chunk.delta && onDelta) onDelta(chunk.delta)
      if (chunk.done) {
        finalMessage   = chunk.message || ''
        finalActions   = Array.isArray(chunk.actions) ? chunk.actions
                       : Array.isArray(chunk.suggestions) ? chunk.suggestions
                       : []
        serverFailed   = !!chunk.failed
        serverErrorMsg = chunk.errorMsg || null
        serverDropped  = Array.isArray(chunk.dropped) ? chunk.dropped : []
      }
    }
    return { message: finalMessage, actions: finalActions, serverFailed, serverErrorMsg, serverDropped }
  }

  // Live preview helper. NOTE: this is best-effort and intentionally simple —
  // it scans for the first occurrence of `"message":"..."` and decodes basic
  // escape sequences. JSON-schema mode emits keys in declared order, so this
  // works in practice. End-of-stream parsing is the source of truth.
  function extractLiveMessage(partial) {
    const marker = '"message":"'
    const start  = partial.indexOf(marker)
    if (start === -1) return null
    let i = start + marker.length, result = ''
    while (i < partial.length) {
      const ch = partial[i]
      if (ch === '\\') {
        i++
        if (i >= partial.length) break
        const e = partial[i]
        if (e === 'n')      result += '\n'
        else if (e === 't') result += '\t'
        else if (e === '"') result += '"'
        else if (e === '\\') result += '\\'
        else if (e === 'u' && i + 4 < partial.length) {
          const hex = partial.slice(i + 1, i + 5)
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            result += String.fromCharCode(parseInt(hex, 16))
            i += 4
          } else {
            result += e
          }
        } else {
          result += e
        }
        i++
        continue
      }
      if (ch === '"') break
      result += ch; i++
    }
    return result
  }

  // ── action prep ────────────────────────────────────────────────────────────
  // Runtime UI metadata is prefixed with `_` so it cannot collide with action
  // payload fields. The action payload's `status` field (active/completed/shelved)
  // is preserved untouched and reaches the backend correctly.
  function prepareActions(raw) {
    return (raw || []).map((a) => ({
      ...a,
      _id:     newId('a'),
      _state:  a.type === 'navigate' ? 'idle' : 'pending',  // navigate waits for click
      _result: null,
      _error:  null,
    }))
  }

  // Heal stuck-pending actions on chat rehydration: if a chat was closed mid-stream,
  // the persisted action's _state will be 'pending' forever. Mark it as error so
  // the user can retry instead of staring at an infinite spinner.
  // Also handles legacy persisted rows where runtime state was stored as `status`
  // (which corrupted the payload status field — those rows lost it permanently).
  function rehydrateActions(rawActions) {
    return (rawActions || []).map((a) => {
      const runtime = a._state ?? a.status   // legacy fallback
      const isLegacy = a._state === undefined && ['pending', 'done', 'error', 'idle'].includes(a.status)
      return {
        ...a,
        _id:     a._id || newId('a'),
        _state:  runtime === 'pending' ? 'error' : (runtime || 'idle'),
        _error:  runtime === 'pending' ? 'Interrupted — retry the turn to redo.' : (a._error ?? a.error ?? null),
        _result: a._result ?? a.result ?? null,
        // Legacy rows had runtime overwriting payload status — strip the bogus value.
        status:  isLegacy ? undefined : a.status,
      }
    })
  }

  // The currently-active AbortController for the in-flight LLM SSE stream.
  // Tracked so cancelVoiceTurn() can abort an in-progress generation.
  let _activeController = null

  // ── core: stream one turn into messages[aiIdx], with watchdog ─────────────
  async function streamAITurn(aiIdx, history, { showLive = true } = {}) {
    const controller = new AbortController()
    _activeController = controller
    let lastChunkAt = Date.now()
    let accumulated = ''
    const watchdog = setInterval(() => {
      if (Date.now() - lastChunkAt > WATCHDOG_MS) controller.abort()
    }, 2000)
    try {
      const { message, actions, serverFailed, serverErrorMsg, serverDropped } = await callAPI(history, (delta) => {
        lastChunkAt = Date.now()
        if (!showLive) return
        accumulated += delta
        const live = extractLiveMessage(accumulated)
        if (live !== null) { messages.value[aiIdx].content = live; scrollBottom() }
      }, controller.signal)
      messages.value[aiIdx].content = message || messages.value[aiIdx].content
      messages.value[aiIdx].actions = prepareActions(actions)
      if (serverDropped?.length) console.warn('[LC] server dropped actions:', serverDropped)

      // Server-side lie detection (claim of action with empty resolved actions)
      if (serverFailed) {
        messages.value[aiIdx].failed   = true
        messages.value[aiIdx].errorMsg = serverErrorMsg || "LC said it acted but nothing executed."
        return { ok: false }
      }
      // Empty-response detection (no message AND no actions)
      if (!messages.value[aiIdx].content && (actions || []).length === 0) {
        messages.value[aiIdx].failed   = true
        messages.value[aiIdx].errorMsg = "LC didn't respond clearly."
        return { ok: false }
      }
      messages.value[aiIdx].failed = false
      return { ok: true, message: messages.value[aiIdx].content, actions }
    } catch (e) {
      const aborted = e?.name === 'AbortError' || controller.signal.aborted
      messages.value[aiIdx].failed   = true
      messages.value[aiIdx].errorMsg = aborted ? 'LC took too long to respond.' : (e?.message || 'Something went wrong.')
      return { ok: false, error: e }
    } finally {
      clearInterval(watchdog)
      if (_activeController === controller) _activeController = null
    }
  }

  async function runAutoActions(aiIdx) {
    const msg = messages.value[aiIdx]
    if (!msg?.actions?.length) return
    let goalsChanged = false
    for (let i = 0; i < msg.actions.length; i++) {
      const action = msg.actions[i]
      if (action.type === 'navigate') continue
      if (action._state !== 'pending') continue
      try {
        await executeAction(aiIdx, i)
        if (['create_goal', 'update_goal', 'delete_goal'].includes(action.type)) goalsChanged = true
      } catch { /* recorded on action */ }
    }
    if (goalsChanged) onGoalsUpdated?.()
  }

  async function executeAction(msgIdx, actionIdx) {
    const msg    = messages.value[msgIdx]
    const action = msg?.actions?.[actionIdx]
    if (!action) return

    action._state = 'pending'
    action._error = null

    try {
      if (action.type === 'create_goal') {
        const created = await apiFetch('/api/goals', {
          method: 'POST',
          body: JSON.stringify({
            title:       action.title,
            description: action.description,
            month:       thisMonthLocal(),
            targetDate:  action.targetDate || null,
            programId:   action.programId  || null,   // optional, resolved server-side from programRef
          }),
        })
        action._result = { id: created.id, title: created.title }
        action._state  = 'done'
      }
      else if (action.type === 'update_goal') {
        if (!action.goalId) throw new Error('Missing goalId')
        // Build the patch from non-blank string fields + numeric progress.
        // The runtime metadata (_state, _result, _error) lives in underscore-
        // prefixed fields, so we never accidentally send it to the backend.
        const patch = {}
        const setStr = (k, v) => { if (typeof v === 'string' && v.trim() !== '') patch[k] = v.trim() }
        setStr('title',       action.title)
        setStr('description', action.description)
        setStr('status',      action.status)       // payload status, e.g. 'completed'
        setStr('targetDate',  action.targetDate)   // YYYY-MM-DD
        if (typeof action.progress === 'number') patch.progress = action.progress
        if (Object.keys(patch).length === 0) throw new Error('Nothing to update')
        const updated = await apiFetch(`/api/goals/${action.goalId}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        })
        action._result = { id: updated.id, title: updated.title, progress: updated.progress, status: updated.status, fields: Object.keys(patch) }
        action._state  = 'done'
      }
      else if (action.type === 'delete_goal') {
        if (!action.goalId) throw new Error('Missing goalId')
        await apiFetch(`/api/goals/${action.goalId}`, { method: 'DELETE' })
        action._result = { id: action.goalId, title: action.goalTitle || action.title || 'goal' }
        action._state  = 'done'
      }
      else if (action.type === 'log_win') {
        // DB CHECK constraint only allows type='daily'|'weekly'; win-ness lives in analysis.wins.
        const today = todayLocal()
        const entry = await apiFetch('/api/entries', {
          method: 'POST',
          body:   JSON.stringify({
            date:      today,
            type:      'daily',
            text:      action.story || action.title || 'Win',
            programId: action.programId || null,
          }),
        })
        const winObj = {
          id:               newId('w'),
          title:            action.title    || 'Win',
          story:            action.story    || '',
          evidence:         action.evidence || '',
          celebrationIdeas: Array.isArray(action.celebrationIdeas) ? action.celebrationIdeas : [],
        }
        await apiFetch(`/api/entries/${entry.id}/analysis`, {
          method: 'PATCH',
          body:   JSON.stringify({ analysis: { summary: action.title || '', wins: [winObj] }, analysisFailed: false }),
        })
        action._result = { entryId: entry.id, title: winObj.title }
        action._state  = 'done'
      }
      else if (action.type === 'create_program') {
        const body = { name: action.name }
        if (action.description)  body.description  = action.description
        if (action.startDate)    body.startDate    = action.startDate
        if (action.endDate)      body.endDate      = action.endDate
        if (typeof action.learnerCount === 'number') body.learnerCount = action.learnerCount
        if (action.status)       body.status       = action.status
        const created = await apiFetch('/api/programs', {
          method: 'POST',
          body:   JSON.stringify(body),
        })
        action._result = { id: created.id, name: created.name }
        action._state  = 'done'
      }
      else if (action.type === 'navigate') {
        onNavigate?.(action.view || 'goals')
        action._state = 'done'
      }
      else {
        throw new Error(`Unknown action type: ${action.type}`)
      }
    } catch (e) {
      action._state = 'error'
      action._error = e?.message || 'Action failed'
      console.error('[LC] action failed:', action.type, e)
      throw e
    }
  }

  async function clickNavigateAction(msgIdx, actionIdx) {
    await executeAction(msgIdx, actionIdx)
  }

  // Re-run the AI turn at messages[msgIdx]. Drops everything from msgIdx onward.
  // If we have a diagnosis from the previous failed turn (errorMsg), inject it
  // as a synthetic user message so the model sees what it did wrong and corrects
  // instead of rolling the dice again.
  async function retryFromMessage(msgIdx) {
    if (streaming.value || convoStatus.value === 'processing') return

    const failedMsg = messages.value[msgIdx]
    const diagnosis = failedMsg?.failed ? failedMsg.errorMsg : null

    messages.value = messages.value.slice(0, msgIdx)
    const history = messages.value.map(m => ({ role: m.role, content: m.content }))

    // Inject the failure diagnosis as a system-style user message so the model
    // doesn't just regenerate the same bad output. We tag it as a user message
    // so it lands in the conversation; the wording is explicit feedback.
    if (diagnosis) {
      history.push({
        role: 'user',
        content: `(System note for retry — your previous response failed: ${diagnosis} Please try again. If you intended a goal-targeting action, use "goalRef" with the goal's title or a fragment, not a UUID.)`,
      })
    }

    messages.value.push({ _id: newId('m'), role: 'assistant', content: '', actions: [], failed: false })
    const aiIdx = messages.value.length - 1

    streaming.value = true
    scrollBottom()
    try {
      const r = await streamAITurn(aiIdx, history)
      scrollBottom()
      if (r.ok) await runAutoActions(aiIdx)
      onAfterTurn?.()
    } finally {
      streaming.value = false
    }
  }

  // ── voice mode ─────────────────────────────────────────────────────────────
  // Speaks `text` and returns true if it played to completion, false if it was
  // interrupted (the user tapped the mic mid-speech, which changes convoStatus
  // out from under us). The caller uses this signal to decide whether to
  // auto-resume listening — we don't want to start a fresh recording on top of
  // one the user just opened by interrupting.
  async function speakAI(text) {
    if (!text) {
      if (convoStatus.value === 'speaking') convoStatus.value = 'idle'
      return false
    }
    convoStatus.value = 'speaking'
    try { await tts.speak(text) } catch { /* aborted */ }
    const interrupted = convoStatus.value !== 'speaking'
    if (!interrupted) convoStatus.value = 'idle'
    return !interrupted
  }

  // Manual-toggle Convo mode: the user starts and ends a turn by clicking the
  // orb. We do NOT auto-stop on silence. Whisper users see the model-loading
  // progress on first start (via stt.isModelLoading / stt.modelLoadProgress).

  function stopConvoRecognition(graceful = false) {
    if (graceful) stt.stop()
    else          stt.abort()
  }

  async function startConvoListening() {
    if (!stt.isSupported) {
      error.value = 'Voice input is not supported in this browser'
      return
    }
    convoTranscript.value = ''
    convoStatus.value = 'listening'
    await stt.start()
  }

  async function runVoiceTurn() {
    if (messages.value.length === 0) {
      error.value = ''
      await addGreeting({ speak: true })
      return
    }

    convoStatus.value = 'processing'
    error.value = ''
    const history = messages.value.map(m => ({ role: m.role, content: m.content }))
    messages.value.push({ _id: newId('m'), role: 'assistant', content: '', actions: [], failed: false })
    const aiIdx = messages.value.length - 1
    const r = await streamAITurn(aiIdx, history, { showLive: false })
    if (r.ok) {
      await runAutoActions(aiIdx)
      // Persist AFTER actions transition to their final _state. Persisting
      // before action execution caused stuck-pending rehydration: reopening
      // the chat would show successful actions as "Interrupted — retry."
      onAfterTurn?.()
      const completed = await speakAI(messages.value[aiIdx].content)
      // Auto-open the mic so the user can reply hands-free. They close it by
      // tapping the orb when they're done. If they interrupted the AI's
      // speech, `completed` is false and they're already recording — skip.
      if (completed && convoStatus.value === 'idle') {
        await startConvoListening()
      }
    } else {
      onAfterTurn?.()
      error.value = messages.value[aiIdx].errorMsg
      convoStatus.value = 'idle'
    }
  }

  function toggleConvoMic() {
    if (convoStatus.value === 'listening') {
      stopConvoRecognition(true); convoStatus.value = 'processing'
    } else if (convoStatus.value === 'idle') {
      startConvoListening()
    } else if (convoStatus.value === 'speaking') {
      tts.stop(); convoStatus.value = 'idle'
      startConvoListening()
    }
  }

  // Hard-cancel whatever voice mode is doing. Use cases:
  //   - User entered LC, mic auto-opened, they don't want to talk → cancel
  //   - User clicked mic, didn't speak, doesn't want to wait for Whisper to
  //     "transcribe silence" before going idle → cancel
  //   - AI is generating but user wants out → cancel
  //   - AI is speaking but user doesn't want to listen and doesn't want to
  //     start a new recording → cancel (toggleConvoMic would start listening)
  // Resets straight to idle without sending, transcribing, or processing.
  function cancelVoiceTurn() {
    _activeController?.abort()        // kill any in-flight LLM SSE request
    stopConvoRecognition(false)       // abort STT — no transcribe, no send
    tts.stop()                        // stop any TTS playback
    convoTranscript.value = ''
    convoStatus.value = 'idle'
  }

  // ── text mode ──────────────────────────────────────────────────────────────
  async function runTextGreeting() {
    await addGreeting()
  }

  async function sendTextMessage(text) {
    const trimmed = (text || '').trim()
    if (!trimmed || streaming.value) return
    messages.value.push({ _id: newId('m'), role: 'user', content: trimmed })
    const history = messages.value.map(m => ({ role: m.role, content: m.content }))
    messages.value.push({ _id: newId('m'), role: 'assistant', content: '', actions: [], failed: false })
    const aiIdx = messages.value.length - 1
    streaming.value = true
    scrollBottom()
    try {
      const r = await streamAITurn(aiIdx, history)
      scrollBottom()
      if (r.ok) await runAutoActions(aiIdx)
      scrollBottom()
      onAfterTurn?.()
    } finally { streaming.value = false }
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  function stopAll() {
    tts.stop()
    stopConvoRecognition(false)
  }
  onUnmounted(stopAll)

  function reset() {
    stopAll()
    messages.value = []
    error.value    = ''
    convoStatus.value     = 'idle'
    convoTranscript.value = ''
  }

  return {
    // state
    messages, error, streaming, chatEl,
    convoStatus, convoTranscript,
    // derived
    lastAiMsg, lastActions, convoStatusLabel,
    // tts passthrough (read-only) — Kokoro tier removed, so no load progress
    // to expose. Components fall back to the browser TTS instantly if
    // ElevenLabs is unavailable.
    ttsSupported: tts.isSupported,
    // stt passthrough — for showing model-load progress and detecting Whisper backend
    sttSupported:    computed(() => stt.isSupported),
    sttBackend:      stt.backend,        // 'native' | 'whisper' | 'none'
    sttLoading:      stt.isModelLoading,
    sttLoadProgress: stt.modelLoadProgress,
    // mutators
    reset, stopAll,
    runTextGreeting, sendTextMessage,
    runVoiceTurn, toggleConvoMic, cancelVoiceTurn, startConvoListening, stopConvoRecognition,
    retryFromMessage, clickNavigateAction, executeAction,
    rehydrateActions, prepareActions, scrollBottom, newId,
  }
}
