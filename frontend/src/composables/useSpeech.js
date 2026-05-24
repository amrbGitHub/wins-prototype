import { ref } from 'vue'

export function useSpeech() {
  const SpeechRecognition =
    typeof window !== 'undefined'
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null

  const isSupported = !!SpeechRecognition
  const isListening = ref(false)

  let recognition = null

  function _abortPrevious() {
    if (recognition) {
      try { recognition.abort() } catch { /* ignore */ }
      recognition = null
    }
  }

  function startListening(onResult) {
    if (!isSupported) return
    // Abort any prior recognition object before creating a new one — otherwise
    // the previous mic stream lingers until GC and the indicator stays on.
    _abortPrevious()

    recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    let finalTranscript = ''

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' '
          onResult(finalTranscript.trimEnd())
        } else {
          interim += transcript
          onResult((finalTranscript + interim).trimEnd())
        }
      }
    }

    recognition.onerror = () => {
      isListening.value = false
    }

    recognition.onend = () => {
      isListening.value = false
      recognition = null
    }

    try {
      recognition.start()
      isListening.value = true
    } catch (e) {
      // InvalidStateError on rapid re-entry. Bail cleanly.
      console.warn('[useSpeech] start() threw:', e)
      isListening.value = false
      recognition = null
    }
  }

  function stopListening() {
    if (recognition) {
      try { recognition.stop() } catch { /* ignore */ }
    }
    isListening.value = false
  }

  function toggleListening(onResult) {
    if (isListening.value) stopListening()
    else                   startListening(onResult)
  }

  return { isSupported, isListening, startListening, stopListening, toggleListening }
}
