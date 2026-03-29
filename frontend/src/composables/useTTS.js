import { ref } from 'vue'

export function useTTS() {
  const isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const isSpeaking  = ref(false)

  let voices = []

  if (isSupported) {
    // Voices load asynchronously in some browsers
    voices = window.speechSynthesis.getVoices()
    window.speechSynthesis.onvoiceschanged = () => {
      voices = window.speechSynthesis.getVoices()
    }
  }

  function getBestVoice() {
    // Prefer natural/neural online voices, then built-in, then any English
    const preferredNames = [
      'Microsoft Ava Online',
      'Microsoft Jenny Online',
      'Microsoft Aria Online',
      'Microsoft Guy Online',
      'Google US English',
      'Samantha',       // macOS
      'Karen',          // macOS
    ]
    for (const name of preferredNames) {
      const match = voices.find(v => v.name.includes(name))
      if (match) return match
    }
    return voices.find(v => v.lang.startsWith('en')) ?? voices[0] ?? null
  }

  // Strip basic markdown so TTS doesn't read out "asterisk asterisk"
  function cleanText(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`(.+?)`/g, '$1')
      .replace(/#{1,6}\s/g, '')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
      .trim()
  }

  /**
   * Speak text aloud. Returns a Promise that resolves when speech ends.
   * Splits on sentence boundaries to work around the Chrome mid-sentence pause bug.
   */
  function speak(text) {
    return new Promise((resolve) => {
      if (!isSupported) { resolve(); return }

      window.speechSynthesis.cancel()
      const cleaned = cleanText(text)
      if (!cleaned) { resolve(); return }

      // Split into sentences so Chrome doesn't cut off long responses
      const sentences = cleaned.match(/[^.!?]+[.!?]*/g) ?? [cleaned]
      let idx = 0

      isSpeaking.value = true

      function speakNext() {
        if (idx >= sentences.length) {
          isSpeaking.value = false
          resolve()
          return
        }
        const utt = new SpeechSynthesisUtterance(sentences[idx++].trim())
        const voice = getBestVoice()
        if (voice) utt.voice = voice
        utt.rate  = 1.05   // slightly faster feels more natural in conversation
        utt.pitch = 1.0
        utt.onend   = speakNext
        utt.onerror = speakNext
        window.speechSynthesis.speak(utt)
      }

      speakNext()
    })
  }

  function stop() {
    if (isSupported) {
      window.speechSynthesis.cancel()
      isSpeaking.value = false
    }
  }

  return { isSupported, isSpeaking, speak, stop }
}
