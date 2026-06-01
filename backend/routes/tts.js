const { Router } = require('express')
const { verifyToken } = require('../middleware/auth')

const router = Router()

// Defaults: Rachel is a warm female voice on the ElevenLabs free tier.
// User can override via env vars without touching code.
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'   // Rachel
const DEFAULT_MODEL_ID = 'eleven_turbo_v2_5'     // fast, low-latency, fine quality

// GET /api/tts/status — frontend uses this on startup to decide which
// backend to use. Doesn't require auth (no secrets returned, just a bool).
router.get('/status', (req, res) => {
  res.json({
    available:  !!process.env.ELEVENLABS_API_KEY,
    voiceId:    process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID,
    modelId:    process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL_ID,
  })
})

// POST /api/tts/speak — proxy text → audio. Auth required so we don't
// burn the user's free-tier quota for random callers.
router.post('/speak', verifyToken, async (req, res) => {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) return res.status(503).json({ error: 'TTS not configured on server' })

  const { text, voiceId, modelId } = req.body || {}
  const cleaned = (text || '').toString().trim()
  if (!cleaned)              return res.status(400).json({ error: 'text is required' })
  if (cleaned.length > 5000) return res.status(400).json({ error: 'text too long (max 5000 chars per request)' })

  const voice  = voiceId || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID
  const model  = modelId || process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL_ID

  // ElevenLabs returns audio/mpeg by default. We forward it as a Buffer.
  // For now we don't stream — small enough for chat responses (~5–15s of audio).
  let upstream
  try {
    upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
      method: 'POST',
      headers: {
        'xi-api-key':    apiKey,
        'Accept':        'audio/mpeg',
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        text:     cleaned,
        model_id: model,
        voice_settings: {
          stability:        0.5,
          similarity_boost: 0.75,
        },
      }),
    })
  } catch (err) {
    return res.status(502).json({ error: `ElevenLabs unreachable: ${err.message}` })
  }

  if (!upstream.ok) {
    const body = await upstream.text().catch(() => '')
    // Common cases: 401 (bad key), 429 (quota exhausted), 422 (bad voice id)
    return res.status(upstream.status).json({
      error: `ElevenLabs error ${upstream.status}`,
      detail: body.slice(0, 500),
    })
  }

  const arrayBuffer = await upstream.arrayBuffer()
  res.setHeader('Content-Type',   'audio/mpeg')
  res.setHeader('Content-Length', arrayBuffer.byteLength)
  res.setHeader('Cache-Control',  'no-cache')
  res.end(Buffer.from(arrayBuffer))
})

module.exports = router
