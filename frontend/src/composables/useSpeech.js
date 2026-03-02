import { ref } from 'vue'

export function useSpeech() {
  const SpeechRecognition =
    typeof window !== 'undefined'
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null

  const isSupported = !!SpeechRecognition
  const isListening = ref(false)

  let recognition = null

  function startListening(onResult) {
    if (!isSupported || isListening.value) return

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
    }

    recognition.start()
    isListening.value = true
  }

  function stopListening() {
    if (recognition && isListening.value) {
      recognition.stop()
    }
    isListening.value = false
  }

  function toggleListening(onResult) {
    if (isListening.value) {
      stopListening()
    } else {
      startListening(onResult)
    }
  }

  return { isSupported, isListening, startListening, stopListening, toggleListening }
}
