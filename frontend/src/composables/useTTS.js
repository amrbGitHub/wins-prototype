/**
 * useTTS — neural text-to-speech powered by Kokoro 82M (ONNX, runs entirely in the browser)
 *
 * The ~82 MB model is downloaded from HuggingFace on first use and cached by
 * the browser indefinitely — all subsequent loads are instant.
 *
 * Voice used: af_heart (American Female "Heart" — overall grade A, the highest quality)
 * Other voices: af_bella (A-), bf_emma (B-), am_michael (C+), bm_george (C)
 */

import { ref } from 'vue'

// ── Module-level singletons (shared across all useTTS() calls) ────────────────
let   _tts         = null   // loaded KokoroTTS instance
let   _loadingProm = null   // in-flight promise (prevents parallel double-load)
let   _audioCtx    = null
let   _currentSrc  = null   // currently playing AudioBufferSourceNode

const _isSpeaking    = ref(false)
const _isLoading     = ref(false)
const _loadProgress  = ref(0)   // 0–100

// ── Text cleanup ──────────────────────────────────────────────────────────────
function cleanForSpeech(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g,    '$1')  // bold
    .replace(/\*(.+?)\*/g,        '$1')  // italic
    .replace(/`(.+?)`/g,          '$1')  // inline code
    .replace(/#{1,6}\s/g,         '')    // headings
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // links → label only
    .replace(/\n+/g,              ' ')
    .trim()
}

// ── AudioContext ──────────────────────────────────────────────────────────────
function getAudioCtx() {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume()
  return _audioCtx
}

// ── Model loading ─────────────────────────────────────────────────────────────
async function loadModel() {
  if (_tts) return _tts
  if (_loadingProm) return _loadingProm   // reuse the in-flight promise

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
          if (status === 'done') {
            _loadProgress.value = 100
          }
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

// ── Public composable ─────────────────────────────────────────────────────────
export function useTTS() {
  const isSupported = typeof window !== 'undefined' &&
    ('AudioContext' in window || 'webkitAudioContext' in window)

  /**
   * Speak text using Kokoro neural TTS.
   * Loads the model on first call — progress shown via isLoading / loadProgress.
   * Returns a Promise that resolves when the audio finishes playing.
   */
  async function speak(text) {
    if (!isSupported) return
    const clean = cleanForSpeech(text)
    if (!clean) return

    try {
      const tts   = await loadModel()
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
      console.error('[useTTS] speak error:', err)
      _isSpeaking.value = false
    }
  }

  /** Immediately stop any playing audio. */
  function stop() {
    if (_currentSrc) {
      try { _currentSrc.stop() } catch { /* already stopped */ }
      _currentSrc = null
    }
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
