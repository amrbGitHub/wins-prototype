<script setup>
import { computed, reactive, ref } from 'vue'

const form = reactive({
  wentWell: '',
  wasHard: '',
  visibleWin: '',
  recognizeWho: '',
  outcome: 'Engagement',
})

const loadingAnalyze = ref(false)
const loadingDraft = ref(false)
const errorMsg = ref('')

const analysis = ref(null) // { summary, wins: [...] }
const selectedWinId = ref(null)

const draft = ref('')
const channel = ref('Email')
const tone = ref('Warm')

const selectedWin = computed(() => {
  if (!analysis.value) return null
  return analysis.value.wins.find(w => w.id === selectedWinId.value) ?? null
})

async function analyzeWeek() {
  errorMsg.value = ''
  analysis.value = null
  selectedWinId.value = null
  draft.value = ''

  loadingAnalyze.value = true
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (!res.ok) throw new Error(await res.text())
    analysis.value = await res.json()
    if (analysis.value?.wins?.length) selectedWinId.value = analysis.value.wins[0].id
  } catch (e) {
    errorMsg.value = e?.message ?? String(e)
  } finally {
    loadingAnalyze.value = false
  }
}

async function generateDraft() {
  errorMsg.value = ''
  draft.value = ''
  if (!selectedWin.value) {
    errorMsg.value = 'Select a win first.'
    return
  }

  loadingDraft.value = true
  try {
    const res = await fetch('/api/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        win: selectedWin.value,
        channel: channel.value,
        tone: tone.value,
        outcome: form.outcome,
        recognizeWho: form.recognizeWho,
      }),
    })
    if (!res.ok) throw new Error(await res.text())
    const data = await res.json()
    draft.value = data.draft
  } catch (e) {
    errorMsg.value = e?.message ?? String(e)
  } finally {
    loadingDraft.value = false
  }
}

async function copyDraft() {
  if (!draft.value) return
  await navigator.clipboard.writeText(draft.value)
  alert('Copied!')
}
</script>

<template>
  <div style="max-width: 980px; margin: 32px auto; padding: 0 16px; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial;">
    <h1>Celebrating Wins (Demo)</h1>
    <p style="color:#444; margin-top: -8px;">
      Weekly check-in → wins detected → celebration drafts.
    </p>

    <div v-if="errorMsg" style="background:#fee; border:1px solid #f99; padding:12px; border-radius:8px; margin: 12px 0;">
      <strong>Error:</strong> <span>{{ errorMsg }}</span>
    </div>

    <section style="display:grid; grid-template-columns: 1fr; gap: 16px;">
      <div style="border:1px solid #ddd; border-radius:12px; padding:16px;">
        <h2 style="margin:0 0 12px;">1) Weekly Check-in</h2>

        <label style="display:block; font-weight:600; margin-top:10px;">What went well?</label>
        <textarea v-model="form.wentWell" rows="3" style="width:100%; padding:10px;"></textarea>

        <label style="display:block; font-weight:600; margin-top:10px;">What was hard?</label>
        <textarea v-model="form.wasHard" rows="3" style="width:100%; padding:10px;"></textarea>

        <label style="display:block; font-weight:600; margin-top:10px;">What win should be visible to leadership?</label>
        <textarea v-model="form.visibleWin" rows="3" style="width:100%; padding:10px;"></textarea>

        <label style="display:block; font-weight:600; margin-top:10px;">Who should be recognized?</label>
        <input v-model="form.recognizeWho" placeholder="Name/team (e.g., Sam + Line 3 supervisors)" style="width:100%; padding:10px;" />

        <label style="display:block; font-weight:600; margin-top:10px;">Primary outcome impacted</label>
        <select v-model="form.outcome" style="padding:10px;">
          <option>Safety</option>
          <option>Quality</option>
          <option>Retention</option>
          <option>Efficiency</option>
          <option>Engagement</option>
        </select>

        <div style="margin-top: 14px;">
          <button @click="analyzeWeek" :disabled="loadingAnalyze" style="padding:10px 14px;">
            {{ loadingAnalyze ? 'Analyzing…' : 'Analyze my week' }}
          </button>
        </div>
      </div>

      <div v-if="analysis" style="border:1px solid #ddd; border-radius:12px; padding:16px;">
        <h2 style="margin:0 0 8px;">2) Wins & Ideas</h2>
        <p style="margin:0 0 12px; color:#444;"><strong>Summary:</strong> {{ analysis.summary }}</p>

        <div style="display:grid; grid-template-columns: 320px 1fr; gap: 12px;">
          <div style="border:1px solid #eee; border-radius:10px; padding:10px;">
            <h3 style="margin:0 0 8px; font-size: 15px;">Detected wins</h3>

            <button
              v-for="w in analysis.wins"
              :key="w.id"
              @click="selectedWinId = w.id; draft=''"
              :style="{
                display:'block',
                width:'100%',
                textAlign:'left',
                padding:'10px',
                marginBottom:'8px',
                borderRadius:'10px',
                border: selectedWinId === w.id ? '2px solid #333' : '1px solid #ccc',
                background: selectedWinId === w.id ? '#f6f6f6' : 'white'
              }"
            >
              <div style="font-weight:700;">{{ w.title }}</div>
              <div style="color:#555; font-size: 13px; margin-top: 4px;">{{ w.story }}</div>
            </button>
          </div>

          <div v-if="selectedWin" style="border:1px solid #eee; border-radius:10px; padding:10px;">
            <h3 style="margin:0 0 8px;">Selected win</h3>
            <p style="margin:0;"><strong>Title:</strong> {{ selectedWin.title }}</p>
            <p style="margin:6px 0;"><strong>Story:</strong> {{ selectedWin.story }}</p>
            <p style="margin:6px 0;"><strong>Evidence:</strong> {{ selectedWin.evidence }}</p>

            <div style="margin-top:10px;">
              <strong>Celebration ideas</strong>
              <ul>
                <li v-for="(idea, idx) in selectedWin.celebrationIdeas" :key="idx">{{ idea }}</li>
              </ul>
            </div>

            <h2 style="margin: 18px 0 8px;">3) Generate a draft</h2>

            <div style="display:flex; gap:10px; flex-wrap: wrap; align-items: center;">
              <label>
                Channel
                <select v-model="channel" style="margin-left:6px; padding:8px;">
                  <option>Email</option>
                  <option>Exec update</option>
                  <option>LinkedIn</option>
                </select>
              </label>

              <label>
                Tone
                <select v-model="tone" style="margin-left:6px; padding:8px;">
                  <option>Warm</option>
                  <option>Crisp</option>
                  <option>Executive</option>
                </select>
              </label>

              <button @click="generateDraft" :disabled="loadingDraft" style="padding:10px 14px;">
                {{ loadingDraft ? 'Generating…' : 'Generate draft' }}
              </button>
            </div>

            <div style="margin-top:12px;">
              <textarea v-model="draft" rows="10" style="width:100%; padding:10px;" placeholder="Your draft will appear here…"></textarea>
              <div style="margin-top:8px;">
                <button @click="copyDraft" :disabled="!draft" style="padding:10px 14px;">Copy</button>
              </div>
            </div>

          </div>
        </div>
      </div>
    </section>

    <p style="margin-top: 18px; color:#666; font-size: 13px;">
      Demo note: no auth, no database, no retention—pure functionality.
    </p>
  </div>
</template>