/**
 * useTTS — neural TTS via Kokoro 82M (ONNX, browser-native)
 * Falls back to Web Speech API if Kokoro fails or times out loading.
 *
 * Best Kokoro voices (A-grade): af_heart, af_bella
 */

import { ref } from 'vue'

const KOKORO_LOAD_TIMEOUT_MS = 30_000   // give up loading the voice model after this

// ── Module-level singletons ───────────────────────────────────────────────────
let   _tts         = null
let   _loadingProm = null
let   _audioCtx    = null
let   _currentSrc  = null
let   _resolveSpeak = null   // pending resolve fn for the Kokoro speak promise; called by stop()

const _isSpeaking   = ref(false)
const _isLoading    = ref(false)
const _loadProgress = ref(0)

// ── Helpers ───────────────────────────────────────────────────────────────────
function cleanForSpeech(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g,    '$1')
    .replace(/\*(.+?)\*/g,        '$1')
    .replace(/`(.+?)`/g,          '$1')
    .replace(/#{1,6}\s/g,         '')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/\n+/g,              ' ')
    .trim()
}

function getAudioCtx() {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume()
  return _audioCtx
}

// ── Kokoro model loading (with timeout) ───────────────────────────────────────
async function loadKokoro() {
  if (_tts) return _tts
  if (_loadingProm) return _loadingProm

  _loadingProm = (async () => {
    _isLoading.value    = true
    _loadProgress.value = 0
    try {
      const { KokoroTTS } = await import('kokoro-js')
      // Race the load against a timeout so coffee-shop wifi doesn't hang us forever.
      const loadPromise = KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0', {
        dtype: 'q8',
        progress_callback: ({ status, progress }) => {
          if (status === 'progress' && typeof progress === 'number') {
            _loadProgress.value = Math.round(progress)
          }
          if (status === 'done') _loadProgress.value = 100
        },
      })
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Kokoro load timed out')), KOKORO_LOAD_TIMEOUT_MS)
      )
      _tts = await Promise.race([loadPromise, timeoutPromise])
      return _tts
    } finally {
      _isLoading.value = false
      _loadingProm     = null
    }
  })()

  return _loadingProm
}

// ── Fallback: Web Speech API ──────────────────────────────────────────────────
function speakFallback(text) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) { resolve(); return }
    window.speechSynthesis.cancel()
    const utt   = new SpeechSynthesisUtterance(text)
    utt.rate    = 1.05
    utt.pitch   = 1.0
    const voices = window.speechSynthesis.getVoices()
    const preferred = ['Microsoft Ava Online', 'Microsoft Jenny Online', 'Google US English', 'Samantha']
    for (const name of preferred) {
      const v = voices.find(v => v.name.includes(name))
      if (v) { utt.voice = v; break }
    }
    _isSpeaking.value  = true
    _resolveSpeak = () => { _resolveSpeak = null; _isSpeaking.value = false; resolve() }
    utt.onend  = () => _resolveSpeak?.()
    utt.onerror = () => _resolveSpeak?.()
    window.speechSynthesis.speak(utt)
  })
}

// Computed once at module load; wrapping as a ref keeps the API consistent so
// useLcChat can destructure it alongside the other reactive state.
const _isSupported = ref(typeof window !== 'undefined' &&
  ('AudioContext' in window || 'webkitAudioContext' in window))

// ── Public composable ─────────────────────────────────────────────────────────
export function useTTS() {
  const isSupported = _isSupported

  async function speak(text) {
    if (!isSupported.value) return
    const clean = cleanForSpeech(text)
    if (!clean) return

    try {
      const tts   = await loadKokoro()
      const audio = await tts.generate(clean, { voice: 'af_heart' })

      await new Promise((resolve) => {
        const ctx = getAudioCtx()
        const buf = ctx.createBuffer(1, audio.audio.length, audio.sampling_rate)
        buf.getChannelData(0).set(audio.audio)

        const src   = ctx.createBufferSource()
        _currentSrc = src
        src.buffer  = buf
        src.connect(ctx.destination)

        _isSpeaking.value = true
        // Track the resolver so stop() can fire it without waiting for onended.
        _resolveSpeak = () => {
          if (!_resolveSpeak) return
          _resolveSpeak = null
          _isSpeaking.value = false
          _currentSrc       = null
          resolve()
        }
        src.onended = () => _resolveSpeak?.()
        src.start()
      })
    } catch (err) {
      console.warn('[useTTS] Kokoro unavailable, using browser TTS:', err.message)
      await speakFallback(clean)
    }
  }

  function stop() {
    // Cancel any pending speak() promise so callers waiting on it don't hang.
    if (_resolveSpeak) {
      const fn = _resolveSpeak
      _resolveSpeak = null
      try { fn() } catch { /* ignore */ }
    }
    if (_currentSrc) {
      try { _currentSrc.stop() } catch { /* already stopped */ }
      _currentSrc = null
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    _isSpeaking.value = false
  }

  return {
    isSupported,
    isSpeaking:   _isSpeaking,
    isLoading:    _isLoading,
    loadProgress: _loadProgress,
    speak,
    stop,
  }
}
