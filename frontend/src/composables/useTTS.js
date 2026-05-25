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
    _resolveSpeak = () => {
      if (!_resolveSpeak) return
      _resolveSpeak = null
      _isSpeaking.value = false
      _currentEl = null
      URL.revokeObjectURL(url)
      resolve()
    }
    audio.onended = () => _resolveSpeak?.()
    audio.onerror = () => { _resolveSpeak?.(); reject(new Error('audio playback error')) }
    audio.play().catch(reject)
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
    speak,
    stop,
  }
}
