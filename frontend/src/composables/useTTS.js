/**
 * useTTS — neural TTS via Kokoro 82M (ONNX, browser-native)
 * Automatically falls back to Web Speech API if Kokoro fails to load.
 *
 * Best Kokoro voices (A-grade): af_heart, af_bella
 */

import { ref } from 'vue'

// ── Module-level singletons ───────────────────────────────────────────────────
let   _tts         = null
let   _loadingProm = null
let   _audioCtx    = null
let   _currentSrc  = null

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

// ── Kokoro model loading ──────────────────────────────────────────────────────
async function loadKokoro() {
  if (_tts) return _tts
  if (_loadingProm) return _loadingProm

  _loadingProm = (async () => {
    _isLoading.value    = true
    _loadProgress.value = 0
    try {
      const { KokoroTTS } = await import('kokoro-js')
      _tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0', {
        dtype: 'q8',
        progress_callback: ({ status, progress }) => {
          if (status === 'progress' && typeof progress === 'number') {
            _loadProgress.value = Math.round(progress)
          }
          if (status === 'done') _loadProgress.value = 100
        },
      })
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
    // Pick best available voice
    const voices = window.speechSynthesis.getVoices()
    const preferred = ['Microsoft Ava Online', 'Microsoft Jenny Online', 'Google US English', 'Samantha']
    for (const name of preferred) {
      const v = voices.find(v => v.name.includes(name))
      if (v) { utt.voice = v; break }
    }
    _isSpeaking.value  = true
    utt.onend  = () => { _isSpeaking.value = false; resolve() }
    utt.onerror = () => { _isSpeaking.value = false; resolve() }
    window.speechSynthesis.speak(utt)
  })
}

// ── Public composable ─────────────────────────────────────────────────────────
export function useTTS() {
  const isSupported = typeof window !== 'undefined' &&
    ('AudioContext' in window || 'webkitAudioContext' in window)

  async function speak(text) {
    if (!isSupported) return
    const clean = cleanForSpeech(text)
    if (!clean) return

    // Try Kokoro; fall back to Web Speech API on any error
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
        src.onended = () => {
          _isSpeaking.value = false
          _currentSrc       = null
          resolve()
        }
        src.start()
      })
    } catch (err) {
      console.warn('[useTTS] Kokoro unavailable, using browser TTS:', err.message)
      await speakFallback(clean)
    }
  }

  function stop() {
    // Stop Kokoro audio
    if (_currentSrc) {
      try { _currentSrc.stop() } catch { /* already stopped */ }
      _currentSrc = null
    }
    // Stop fallback Web Speech
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
