/**
 * useSTT — unified speech-to-text composable.
 *
 * Two backends, same interface:
 *   1. Native SpeechRecognition — Chrome / Edge / Safari. Streaming, ~instant.
 *      Audio is uploaded to Google's STT service under the hood.
 *   2. Whisper (whisper-tiny.en via transformers.js) — Firefox + everything else.
 *      Record then transcribe. Fully local. ~75MB one-time download.
 *
 * Backend is picked at call time: native if available, Whisper as fallback.
 * Both backends respect manual toggle (start → stop, no auto end-of-turn).
 *
 * Usage:
 *   const stt = useSTT({
 *     onText:  (text, isFinal) => { ... },   // partial or final transcript
 *     onEnd:   () => { ... },                // recording fully finished
 *     onError: (msg) => { ... },
 *   })
 *   await stt.start()
 *   stt.stop()    // graceful, fires onText(final) + onEnd
 *   stt.abort()   // immediate, no callbacks
 */

import { ref } from 'vue'

// ── Whisper model singletons ─────────────────────────────────────────────────
// `Xenova/whisper-tiny.en` is the standard transformers.js port. ~75MB. The
// .en suffix is English-only and noticeably faster than the multilingual model.
const WHISPER_MODEL = 'Xenova/whisper-tiny.en'
let _whisperPipeline = null         // resolved ASR pipeline (singleton)
let _whisperLoadingProm = null      // in-flight load promise
const _whisperLoading       = ref(false)
const _whisperLoadProgress  = ref(0)

async function loadWhisperPipeline() {
  if (_whisperPipeline)    return _whisperPipeline
  if (_whisperLoadingProm) return _whisperLoadingProm

  _whisperLoadingProm = (async () => {
    _whisperLoading.value      = true
    _whisperLoadProgress.value = 0
    try {
      const { pipeline } = await import('@huggingface/transformers')
      _whisperPipeline = await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
        progress_callback: ({ status, progress }) => {
          if (status === 'progress' && typeof progress === 'number') {
            _whisperLoadProgress.value = Math.round(progress)
          }
          if (status === 'done') _whisperLoadProgress.value = 100
        },
      })
      return _whisperPipeline
    } finally {
      _whisperLoading.value = false
      _whisperLoadingProm   = null
    }
  })()

  return _whisperLoadingProm
}

// ── Audio decode: MediaRecorder Blob → Float32Array @ 16kHz mono ─────────────
// Whisper expects 16kHz mono float32 in [-1, 1]. AudioContext.decodeAudioData
// with `sampleRate: 16000` resamples for free on modern browsers (Chrome 102+,
// Firefox 110+, Safari 17+).
async function blobTo16kMono(blob) {
  const arrayBuffer = await blob.arrayBuffer()
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 })
  try {
    const audioBuf = await ctx.decodeAudioData(arrayBuffer)
    // Take channel 0. Most mic captures are mono anyway.
    return audioBuf.getChannelData(0).slice()
  } finally {
    ctx.close()
  }
}

async function transcribeBlob(blob) {
  const asr = await loadWhisperPipeline()
  const samples = await blobTo16kMono(blob)
  if (!samples.length) return ''
  // No options needed for whisper-tiny.en — language and task are baked in.
  // Passing them explicitly fails with "Cannot specify `task` or `language`".
  const result = await asr(samples)
  return (result?.text || '').trim()
}

// ── Capability detection ─────────────────────────────────────────────────────
function hasNative() {
  return typeof window !== 'undefined' &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition)
}
function hasRecorder() {
  return typeof window !== 'undefined' &&
    !!navigator?.mediaDevices?.getUserMedia &&
    typeof window.MediaRecorder !== 'undefined'
}

function pickBackend(prefer) {
  if (prefer === 'whisper' && hasRecorder()) return 'whisper'   // explicit override
  if (hasNative())   return 'native'
  if (hasRecorder()) return 'whisper'
  return 'none'
}

// ── Composable ───────────────────────────────────────────────────────────────
export function useSTT({ onText, onEnd, onError, prefer } = {}) {
  const backend = pickBackend(prefer)
  const isSupported = backend !== 'none'

  // Per-instance state. Module-level loader state is shared across instances.
  let nativeRec      = null
  let mediaRecorder  = null
  let mediaStream    = null
  let audioChunks    = []
  let _runId         = 0                // discard callbacks from superseded runs

  function _releaseMicStream() {
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => { try { t.stop() } catch {} })
      mediaStream = null
    }
  }

  async function _startNative(myId) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const rec = new SR()
    nativeRec = rec
    rec.continuous     = true
    rec.interimResults = true
    rec.lang           = 'en-US'

    let finalText = ''

    rec.onresult = (ev) => {
      if (myId !== _runId) return
      let interim = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript + ' '
        else                       interim   += ev.results[i][0].transcript
      }
      onText?.((finalText + interim).trimEnd(), false)
    }
    rec.onerror = (e) => {
      if (myId !== _runId) return
      if (e.error === 'no-speech') return
      onError?.(`Mic error: ${e.error}`)
    }
    rec.onend = () => {
      if (myId !== _runId) return
      nativeRec = null
      const text = finalText.trim()
      if (text) onText?.(text, true)
      onEnd?.()
    }

    try {
      rec.start()
    } catch (e) {
      // InvalidStateError on rapid toggles
      console.warn('[useSTT] native start() threw, retrying:', e)
      await new Promise(r => setTimeout(r, 250))
      if (myId !== _runId) return
      try { rec.start() } catch (e2) {
        nativeRec = null
        onError?.(e2.message || 'Could not start microphone')
      }
    }
  }

  async function _startWhisper(myId) {
    // Lazy-load the model. Caller-visible state (`isModelLoading`,
    // `modelLoadProgress`) reflects this so the UI can show a progress ring.
    try {
      await loadWhisperPipeline()
    } catch (e) {
      onError?.(`Voice model failed to load: ${e.message || e}`)
      return
    }
    if (myId !== _runId) return   // user aborted while model was loading

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      onError?.(`Microphone permission denied or unavailable`)
      return
    }
    if (myId !== _runId) { _releaseMicStream(); return }

    audioChunks = []
    // Let the browser pick its preferred mime. Chrome: webm/opus, Firefox:
    // ogg/opus, Safari: mp4. decodeAudioData handles all three.
    try {
      mediaRecorder = new MediaRecorder(mediaStream)
    } catch (e) {
      _releaseMicStream()
      onError?.(`MediaRecorder failed: ${e.message}`)
      return
    }

    mediaRecorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) audioChunks.push(ev.data)
    }
    mediaRecorder.onerror = (e) => {
      if (myId !== _runId) return
      onError?.(`Recorder error: ${e.error?.message || 'unknown'}`)
    }
    mediaRecorder.onstop = async () => {
      const recorderMime = mediaRecorder?.mimeType || 'audio/webm'
      mediaRecorder = null
      _releaseMicStream()
      if (myId !== _runId) return
      if (!audioChunks.length) { onEnd?.(); return }

      try {
        const blob = new Blob(audioChunks, { type: recorderMime })
        const text = await transcribeBlob(blob)
        if (myId !== _runId) return
        if (text) onText?.(text, true)
      } catch (e) {
        if (myId === _runId) onError?.(`Transcription failed: ${e.message || e}`)
      } finally {
        audioChunks = []
        if (myId === _runId) onEnd?.()
      }
    }

    mediaRecorder.start()
  }

  async function start() {
    if (!isSupported) {
      onError?.('Voice input is not supported in this browser')
      return
    }
    _runId++
    const myId = _runId
    if (backend === 'native') return _startNative(myId)
    if (backend === 'whisper') return _startWhisper(myId)
  }

  // Graceful stop. Behaviour by state:
  //   - Actively recording → triggers the backend's natural end-of-stream,
  //     which fires onText(final) + onEnd (or onEnd alone if nothing captured).
  //   - Loading model / awaiting mic permission / no recording yet → invalidates
  //     the in-flight start, releases any held resources, and fires onEnd so the
  //     caller's state machine doesn't get stuck.
  function stop() {
    if (backend === 'native' && nativeRec) {
      try { nativeRec.stop() } catch {}
      return
    }
    if (backend === 'whisper' && mediaRecorder && mediaRecorder.state !== 'inactive') {
      try { mediaRecorder.stop() } catch {}
      return
    }
    // No active recording — cancel any pending start and notify the caller.
    _runId++
    _releaseMicStream()
    audioChunks = []
    onEnd?.()
  }

  // Hard abort: no callbacks. Used when the chat is unmounted or the user
  // switches input mode mid-recording.
  function abort() {
    _runId++   // invalidates any in-flight handlers
    if (nativeRec) {
      try { nativeRec.abort() } catch {}
      nativeRec = null
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try { mediaRecorder.stop() } catch {}
      mediaRecorder = null
    }
    _releaseMicStream()
    audioChunks = []
  }

  return {
    backend,                           // 'native' | 'whisper' | 'none'
    isSupported,
    isModelLoading:    _whisperLoading,
    modelLoadProgress: _whisperLoadProgress,
    start,
    stop,
    abort,
  }
}
