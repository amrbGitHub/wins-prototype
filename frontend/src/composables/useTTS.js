/**
 * useTTS — two-tier TTS with graceful fallback.
 *
 *   1. ElevenLabs (server-proxied via /api/tts/speak) — the real voice
 *      Available when the backend has ELEVENLABS_API_KEY set AND the
 *      account tier permits library voices (free tier blocks them).
 *
 *   2. Web Speech API (browser-builtin SpeechSynthesis)
 *      Fallback when ElevenLabs is unavailable or fails. Voice quality
 *      is OS-dependent — fine on Windows (Aria) and Mac (Samantha),
 *      noticeably robotic elsewhere.
 *
 * The Kokoro WASM tier was removed: HuggingFace started gating its model
 * downloads behind authentication, which broke the local-only path and
 * left us shipping ~85MB of dependencies for a feature that no longer
 * worked. ElevenLabs is the only voice path worth optimizing for.
 *
 * `speak()` always tries 1, then 2.
 * `stop()` cancels whichever is currently producing audio.
 */

import { ref } from 'vue'
import { useAuth } from './useAuth.js'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

// ── Module-level singletons (shared across all useTTS() callers) ─────────────
let   _currentEl   = null      // ElevenLabs HTMLAudioElement
let   _resolveSpeak = null     // resolver for the in-flight speak promise

const _isSpeaking    = ref(false)
const _backendInUse  = ref('unknown')   // 'elevenlabs' | 'fallback' | 'unknown'

// ── Live audio levels (visualizer) ───────────────────────────────────────────
// 5 normalized bin amplitudes [0,1] sampled from the AnalyserNode each rAF
// while ElevenLabs audio is playing. Components read this to drive the
// orb's bar heights when LC is speaking. Stays at zeros for the browser-TTS
// fallback (no MediaElementSource available for SpeechSynthesis).
const NUM_BANDS = 5
const _levels = ref(Array(NUM_BANDS).fill(0))

let _audioCtx     = null   // shared AudioContext (lazy)
let _analyser     = null   // shared AnalyserNode
let _sourceNode   = null   // current MediaElementAudioSourceNode (per audio el)
let _rafToken     = 0
let _smoothLevels = Array(NUM_BANDS).fill(0)

function ensureAudioCtx() {
  if (_audioCtx) return _audioCtx
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  _audioCtx = new AC()
  _analyser = _audioCtx.createAnalyser()
  _analyser.fftSize = 64                // 32 frequency bins, plenty for 5 bars
  _analyser.smoothingTimeConstant = 0.7
  _analyser.connect(_audioCtx.destination)
  return _audioCtx
}

function attachVisualizer(audio) {
  const ctx = ensureAudioCtx()
  if (!ctx) return
  try {
    // MediaElementAudioSourceNode is one-shot per element; a fresh audio
    // element is created for every speak() call, so we always make a new one.
    _sourceNode = ctx.createMediaElementSource(audio)
    _sourceNode.connect(_analyser)
    // iOS / Chrome may park the context until a user gesture.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  } catch {
    // Safari throws if the element was already attached; we just skip the
    // visualizer rather than break playback.
    return
  }
  const bins = new Uint8Array(_analyser.frequencyBinCount)
  const tick = () => {
    if (!_sourceNode) return
    _analyser.getByteFrequencyData(bins)
    // Split bins into NUM_BANDS contiguous groups and average each.
    const groupSize = Math.floor(bins.length / NUM_BANDS)
    const next = []
    for (let b = 0; b < NUM_BANDS; b++) {
      let sum = 0
      for (let i = 0; i < groupSize; i++) sum += bins[b * groupSize + i]
      // Normalize 0-255 → 0-1 and slightly boost low-volume signals so the
      // bars feel responsive on quieter speech.
      const raw = Math.min(1, (sum / groupSize / 255) * 1.4)
      // Lerp toward the new value for a smooth rise/fall.
      _smoothLevels[b] = _smoothLevels[b] * 0.55 + raw * 0.45
      next.push(_smoothLevels[b])
    }
    _levels.value = next
    _rafToken = requestAnimationFrame(tick)
  }
  _rafToken = requestAnimationFrame(tick)
}

function detachVisualizer() {
  if (_rafToken) cancelAnimationFrame(_rafToken)
  _rafToken = 0
  if (_sourceNode) {
    try { _sourceNode.disconnect() } catch { /* ignore */ }
    _sourceNode = null
  }
  _smoothLevels = Array(NUM_BANDS).fill(0)
  _levels.value = Array(NUM_BANDS).fill(0)
}

// Server TTS availability — detected once per page load.
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
    attachVisualizer(audio)

    // Single-settle guard. Without this, stop() used to null `_resolveSpeak`
    // then call it — and the closure's own `if (!_resolveSpeak) return` guard
    // tripped, so resolve() never ran. The await then saw the AbortError that
    // pause()+src='' triggers on the pending audio.play() promise, and speak()
    // treated it as an ElevenLabs failure and fell back to the browser's
    // robot voice mid-message. The local `settled` flag fixes both halves:
    // resolve actually fires on stop, and any reject that races in afterward
    // (from the aborted play() promise or the synthetic onerror) is a no-op.
    let settled = false
    function cleanup() {
      _isSpeaking.value = false
      _currentEl = null
      detachVisualizer()
      URL.revokeObjectURL(url)
    }
    function resolveOnce() {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    function rejectOnce(err) {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }

    _resolveSpeak = resolveOnce
    audio.onended = resolveOnce
    audio.onerror = () => rejectOnce(new Error('audio playback error'))
    audio.play().catch(rejectOnce)
  })
}

// ── Tier 2: Web Speech API fallback ──────────────────────────────────────────
function speakFallback(text) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) { resolve(); return }
    window.speechSynthesis.cancel()
    const utt = new SpeechSynthesisUtterance(text)
    utt.rate  = 1.05
    utt.pitch = 1.0
    const voices = window.speechSynthesis.getVoices()
    const preferred = ['Microsoft Ava Online', 'Microsoft Jenny Online', 'Google US English', 'Samantha']
    for (const name of preferred) {
      const v = voices.find(v => v.name.includes(name))
      if (v) { utt.voice = v; break }
    }
    _isSpeaking.value = true
    _resolveSpeak = () => { _resolveSpeak = null; _isSpeaking.value = false; resolve() }
    utt.onend   = () => _resolveSpeak?.()
    utt.onerror = () => _resolveSpeak?.()
    window.speechSynthesis.speak(utt)
  })
}

// ── Capability detection ─────────────────────────────────────────────────────
const _isSupported = ref(typeof window !== 'undefined' &&
  ('speechSynthesis' in window))

// ── Public composable ────────────────────────────────────────────────────────
export function useTTS() {
  const isSupported = _isSupported

  async function speak(text) {
    if (!isSupported.value) return
    const clean = cleanForSpeech(text)
    if (!clean) return

    // Tier 1: ElevenLabs (if backend has the key and account permits)
    if (await checkServerTts()) {
      try {
        await speakViaElevenLabs(clean)
        _backendInUse.value = 'elevenlabs'
        console.info('[useTTS] backend=elevenlabs')
        return
      } catch (err) {
        console.warn('[useTTS] ElevenLabs failed, falling back to browser TTS:', err.message)
        // Fall through to tier 2
      }
    } else {
      console.info('[useTTS] ElevenLabs unavailable — using browser TTS')
    }

    // Tier 2: browser SpeechSynthesis
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
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    _isSpeaking.value = false
  }

  return {
    isSupported,
    isSpeaking:   _isSpeaking,
    backendInUse: _backendInUse,
    levels:       _levels,   // 5 normalized [0,1] amplitudes, live during ElevenLabs playback
    speak,
    stop,
  }
}
