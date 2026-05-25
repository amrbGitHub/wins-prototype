/**
 * useTTS — three-tier neural TTS with graceful fallback.
 *
 *   1. ElevenLabs (server-proxied via /api/tts/speak)   — most natural voice
 *      Available when the backend has ELEVENLABS_API_KEY set. Streams audio/mpeg
 *      to an HTMLAudioElement. Quotaed by the user's ElevenLabs free/paid tier.
 *
 *   2. Kokoro 82M (browser WASM via @huggingface/transformers)
 *      Fully local. ~85MB one-time download. Used when ElevenLabs is not
 *      configured OR the call fails (network, quota, auth).
 *
 *   3. Web Speech API (browser-builtin SpeechSynthesis)
 *      Last-resort fallback. Voice quality is OS-dependent.
 *
 * The picker is automatic. `speak()` always tries 1, then 2, then 3.
 * stop() cancels whichever is currently producing audio.
 */

import { ref } from 'vue'
import { useAuth } from './useAuth.js'

const KOKORO_LOAD_TIMEOUT_MS = 30_000
// Same BASE_URL pattern useApi uses, so cross-origin / proxy setups work.
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

// ── Module-level singletons (shared across all useTTS() callers) ─────────────
let   _tts         = null
let   _loadingProm = null
let   _audioCtx    = null
let   _currentSrc  = null      // Kokoro AudioBufferSourceNode (tier 2)
let   _currentEl   = null      // ElevenLabs HTMLAudioElement (tier 1)
let   _resolveSpeak = null     // resolver for the in-flight speak promise

const _isSpeaking    = ref(false)
const _isLoading     = ref(false)
const _loadProgress  = ref(0)
const _backendInUse  = ref('unknown')   // 'elevenlabs' | 'kokoro' | 'fallback' | 'unknown'

// Server TTS availability — detected once on first speak() call so we can
// short-circuit subsequent calls without re-asking the backend each turn.
let _serverTtsKnown    = false
let _serverTtsAvailable = false
async function checkServerTts() {
  if (_serverTtsKnown) return _serverTtsAvailable
  try {
    const res = await fetch(`${BASE_URL}/api/tts/status`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    console.info('[useTTS] /api/tts/status →', data)
    _serverTtsAvailable = !!data.available
  } catch {
    _serverTtsAvailable = false
  }
  _serverTtsKnown = true
  return _serverTtsAvailable
}

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

// ── Tier 1: ElevenLabs via backend proxy ─────────────────────────────────────
async function speakViaElevenLabs(text) {
  const { getAccessToken } = useAuth()
  const token = getAccessToken()
  if (!token) throw new Error('no auth token')
  const res = await fetch(`${BASE_URL}/api/tts/speak`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`ElevenLabs proxy ${res.status}: ${detail.slice(0, 200)}`)
  }
  const blob = await res.blob()
  const url  = URL.createObjectURL(blob)

  await new Promise((resolve, reject) => {
    const audio = new Audio(url)
    _currentEl = audio
    _isSpeaking.value = true
    _resolveSpeak = () => {
      if (!_resolveSpeak) return
      _resolveSpeak = null
      _isSpeaking.value = false
      _currentEl = null
      URL.revokeObjectURL(url)
      resolve()
    }
    audio.onended = () => _resolveSpeak?.()
    audio.onerror = (e) => { _resolveSpeak?.(); reject(new Error('audio playback error')) }
    audio.play().catch(reject)
  })
}

// ── Tier 2: Kokoro WASM ──────────────────────────────────────────────────────
async function loadKokoro() {
  if (_tts) return _tts
  if (_loadingProm) return _loadingProm

  _loadingProm = (async () => {
    _isLoading.value    = true
    _loadProgress.value = 0
    try {
      const { KokoroTTS } = await import('kokoro-js')
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

async function speakViaKokoro(text) {
  const tts   = await loadKokoro()
  const audio = await tts.generate(text, { voice: 'af_heart' })

  await new Promise((resolve) => {
    const ctx = getAudioCtx()
    const buf = ctx.createBuffer(1, audio.audio.length, audio.sampling_rate)
    buf.getChannelData(0).set(audio.audio)

    const src   = ctx.createBufferSource()
    _currentSrc = src
    src.buffer  = buf
    src.connect(ctx.destination)

    _isSpeaking.value = true
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
}

// ── Tier 3: Web Speech API fallback ──────────────────────────────────────────
function speakFallback(text) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) { resolve(); return }
    window.speechSynthesis.cancel()
    const utt = new SpeechSynthesisUtterance(text)
    utt.rate = 1.05
    utt.pitch = 1.0
    const voices = window.speechSynthesis.getVoices()
    const preferred = ['Microsoft Ava Online', 'Microsoft Jenny Online', 'Google US English', 'Samantha']
    for (const name of preferred) {
      const v = voices.find(v => v.name.includes(name))
      if (v) { utt.voice = v; break }
    }
    _isSpeaking.value = true
    _resolveSpeak = () => { _resolveSpeak = null; _isSpeaking.value = false; resolve() }
    utt.onend  = () => _resolveSpeak?.()
    utt.onerror = () => _resolveSpeak?.()
    window.speechSynthesis.speak(utt)
  })
}

// ── Capability detection ─────────────────────────────────────────────────────
const _isSupported = ref(typeof window !== 'undefined' &&
  ('AudioContext' in window || 'webkitAudioContext' in window))

// ── Public composable ────────────────────────────────────────────────────────
export function useTTS() {
  const isSupported = _isSupported

  async function speak(text) {
    if (!isSupported.value) return
    const clean = cleanForSpeech(text)
    if (!clean) return

    // Tier 1: ElevenLabs (if backend has the key)
    const serverAvailable = await checkServerTts()
    if (serverAvailable) {
      try {
        await speakViaElevenLabs(clean)
        _backendInUse.value = 'elevenlabs'
        console.info('[useTTS] backend=elevenlabs')
        return
      } catch (err) {
        console.warn('[useTTS] ElevenLabs failed, falling back to Kokoro:', err.message)
        // Fall through to tier 2
      }
    } else {
      console.info('[useTTS] /api/tts/status reports ElevenLabs unavailable — using Kokoro')
    }

    // Tier 2: Kokoro
    try {
      await speakViaKokoro(clean)
      _backendInUse.value = 'kokoro'
      console.info('[useTTS] backend=kokoro')
      return
    } catch (err) {
      console.warn('[useTTS] Kokoro failed, using browser TTS:', err.message)
    }

    // Tier 3: browser SpeechSynthesis
    _backendInUse.value = 'fallback'
    console.info('[useTTS] backend=browser-fallback')
    await speakFallback(clean)
  }

  function stop() {
    if (_resolveSpeak) {
      const fn = _resolveSpeak
      _resolveSpeak = null
      try { fn() } catch { /* ignore */ }
    }
    if (_currentEl) {
      try { _currentEl.pause(); _currentEl.src = '' } catch { /* ignore */ }
      _currentEl = null
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
    isSpeaking:    _isSpeaking,
    isLoading:     _isLoading,    // reflects Kokoro load — ElevenLabs is server-side, no load state needed
    loadProgress:  _loadProgress,
    backendInUse:  _backendInUse, // useful for debugging which backend served the last turn
    speak,
    stop,
  }
}
