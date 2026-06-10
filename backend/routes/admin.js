// Admin-only routes. Mounted at /api/admin. Every route chains verifyToken +
// requireAdmin. Service-role Supabase client is used; RLS is bypassed by
// design — admin inspection needs to read every user's data.
//
// Privacy boundary: we surface plaintext journal entries, goals, programs,
// reflections (these already live as plaintext in DB). We do NOT decrypt
// pseudonym_registry rows or summary tables — that boundary is intentional
// (see [[feedback-ai-privacy]] in memory).

const { Router } = require('express')
const { supabase } = require('../config')
const { verifyToken, requireAdmin } = require('../middleware/auth')
const { getLlmConfig, setLlmConfig } = require('../lib/llmConfig')
const { PROVIDERS, isSupportedProvider } = require('../lib/providers')

const router = Router()

router.use(verifyToken, requireAdmin)

// ── LLM config ──────────────────────────────────────────────────────────────
// GET returns the current settings (without the API key); response includes a
// `hasApiKey` boolean so the UI can show whether a key is stored.
router.get('/llm-config', async (req, res) => {
  try {
    const cfg = await getLlmConfig()
    // Also report which provider slots have a stored key, so the UI can
    // tell the admin "Anthropic key stored, OpenAI key missing" etc.
    const { supabase } = require('../config')
    const { data } = await supabase
      .from('app_config').select('value').eq('key', 'llm').maybeSingle()
    const byProvider = data?.value?.apiKeyEncByProvider || {}
    const legacy    = data?.value?.apiKeyEnc
    const slots = {}
    for (const p of PROVIDERS) {
      slots[p] = !!byProvider[p] || (p === (data?.value?.providerType || 'anthropic') && !!legacy)
    }
    res.json({
      providerType: cfg.providerType || 'anthropic',
      providers:    PROVIDERS,
      baseUrl:      cfg.baseUrl      || '',
      chatModel:    cfg.chatModel    || '',
      summaryModel: cfg.summaryModel || '',
      temperature:  cfg.temperature,
      maxTokens:    cfg.maxTokens,
      hasApiKey:    !!cfg.apiKey,
      keyStoredFor: slots,
    })
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// PUT saves new config. Omit apiKey to keep the existing one. Passing an
// empty-string apiKey explicitly does NOT clear — to clear, pass null.
router.put('/llm-config', async (req, res) => {
  try {
    const { providerType, baseUrl, chatModel, summaryModel, apiKey, temperature, maxTokens } = req.body || {}
    if (providerType !== undefined && !isSupportedProvider(providerType)) {
      return res.status(400).json({ error: `Unsupported providerType "${providerType}". Use one of: ${PROVIDERS.join(', ')}.` })
    }
    const patch = {}
    if (providerType !== undefined) patch.providerType = providerType
    if (baseUrl      !== undefined) patch.baseUrl      = baseUrl
    if (chatModel    !== undefined) patch.chatModel    = chatModel
    if (summaryModel !== undefined) patch.summaryModel = summaryModel
    if (apiKey       !== undefined) patch.apiKey       = apiKey  // null clears, string sets, undefined keeps
    if (typeof temperature === 'number') patch.temperature = temperature
    if (typeof maxTokens   === 'number') patch.maxTokens   = maxTokens
    await setLlmConfig(patch)
    res.json({ ok: true })
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// ── Users ───────────────────────────────────────────────────────────────────
// GET /api/admin/users — every user with email + profile snapshot + counts.
// Paginates via Supabase admin API; first 100 users for the prototype.
router.get('/users', async (req, res) => {
  try {
    const { data: authData, error: authErr } = await supabase.auth.admin.listUsers({
      page: 1, perPage: 100,
    })
    if (authErr) throw authErr
    const authUsers = authData?.users || []
    const userIds = authUsers.map(u => u.id)
    if (!userIds.length) return res.json([])

    // Parallel fetch profile rows + counts. Supabase doesn't have a clean
    // GROUP BY in the JS client, so we pull all relevant rows and tally
    // client-side. For prototype-scale data this is fine; revisit if user
    // count grows.
    const [profilesRes, goalsRes, entriesRes, programsRes] = await Promise.all([
      supabase.from('profiles').select('user_id,first_name,last_name,role').in('user_id', userIds),
      supabase.from('goals').select('user_id').in('user_id', userIds),
      supabase.from('journal_entries').select('user_id').in('user_id', userIds),
      supabase.from('programs').select('user_id').in('user_id', userIds),
    ])
    if (profilesRes.error) throw profilesRes.error
    if (goalsRes.error)    throw goalsRes.error
    if (entriesRes.error)  throw entriesRes.error
    if (programsRes.error) throw programsRes.error

    const profileMap = new Map((profilesRes.data || []).map(p => [p.user_id, p]))
    const tally = (rows) => {
      const m = new Map()
      for (const r of rows || []) m.set(r.user_id, (m.get(r.user_id) || 0) + 1)
      return m
    }
    const goalsByUser    = tally(goalsRes.data)
    const entriesByUser  = tally(entriesRes.data)
    const programsByUser = tally(programsRes.data)

    const result = authUsers.map(u => {
      const prof = profileMap.get(u.id)
      return {
        userId:    u.id,
        email:     u.email,
        createdAt: u.created_at,
        firstName: prof?.first_name || '',
        lastName:  prof?.last_name  || '',
        role:      prof?.role       || 'user',
        counts: {
          goals:    goalsByUser.get(u.id)    || 0,
          entries:  entriesByUser.get(u.id)  || 0,
          programs: programsByUser.get(u.id) || 0,
        },
      }
    })
    // Sort: admins first, then most recent signup.
    result.sort((a, b) => {
      if (a.role !== b.role) return a.role === 'admin' ? -1 : 1
      return (b.createdAt || '').localeCompare(a.createdAt || '')
    })
    res.json(result)
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// GET /api/admin/users/:userId — full inspection payload for one user.
router.get('/users/:userId', async (req, res) => {
  try {
    const userId = req.params.userId
    const { data: userData, error: userErr } = await supabase.auth.admin.getUserById(userId)
    if (userErr) throw userErr
    if (!userData?.user) return res.status(404).json({ error: 'User not found' })

    const [profileRes, goalsRes, programsRes, entriesRes, reflectionsRes, convRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('goals').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('programs').select('*').eq('user_id', userId).order('updated_at', { ascending: false }),
      supabase.from('journal_entries').select('id,date,type,text,analysis,created_at').eq('user_id', userId).order('date', { ascending: false }).limit(50),
      supabase.from('reflections').select('id,month,evaluation,suggestions,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
      supabase.from('lc_conversations').select('id,title,messages,created_at,updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(50),
    ])
    if (profileRes.error && profileRes.error.code !== 'PGRST116') throw profileRes.error
    if (goalsRes.error)       throw goalsRes.error
    if (programsRes.error)    throw programsRes.error
    if (entriesRes.error)     throw entriesRes.error
    if (reflectionsRes.error) throw reflectionsRes.error
    if (convRes.error)        throw convRes.error

    const prof = profileRes.data
    res.json({
      userId,
      email:     userData.user.email,
      createdAt: userData.user.created_at,
      profile: prof ? {
        firstName:    prof.first_name,
        lastName:     prof.last_name,
        learningStyle: prof.learning_style,
        aiPersonality: prof.ai_personality,
        role:         prof.role || 'user',
      } : null,
      goals: (goalsRes.data || []).map(g => ({
        id: g.id, title: g.title, description: g.description, status: g.status,
        progress: g.progress, month: g.month, targetDate: g.target_date,
      })),
      programs: (programsRes.data || []).map(p => ({
        id: p.id, name: p.name, description: p.description, status: p.status,
        startDate: p.start_date, endDate: p.end_date, learnerCount: p.learner_count,
      })),
      entries: (entriesRes.data || []).map(e => ({
        id: e.id, date: e.date, type: e.type, text: e.text,
        wins: e.analysis?.wins || [],
      })),
      reflections: (reflectionsRes.data || []).map(r => ({
        id: r.id, month: r.month, evaluation: r.evaluation,
        suggestions: r.suggestions,
      })),
      conversations: (convRes.data || []).map(c => ({
        id: c.id,
        title: c.title || 'Untitled chat',
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        messageCount: Array.isArray(c.messages) ? c.messages.length : 0,
        messages: Array.isArray(c.messages)
          ? c.messages.map(m => ({ role: m.role, content: m.content }))
          : [],
      })),
    })
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

// DELETE /api/admin/users/:userId — nuke a user and everything they own.
// Order matters: delete app-level rows first (RLS bypass via service role),
// then drop the auth.users row. Most user-scoped tables have ON DELETE
// CASCADE from auth.users so the explicit deletes are belt-and-suspenders;
// they also make the result counts visible and prevent any FK row that
// somehow isn't cascading from being left behind.
//
// Safety rails:
//   - Cannot delete yourself (admin self-deletion would lock you out
//     mid-action with no recovery path).
//   - Cannot delete another admin (avoid an admin nuking the only other
//     admin by accident; promote/demote out-of-band first if needed).
router.delete('/users/:userId', async (req, res) => {
  try {
    const targetId = req.params.userId
    if (!targetId) return res.status(400).json({ error: 'userId required' })
    if (targetId === req.userId) {
      return res.status(400).json({ error: 'Refusing to delete your own admin account.' })
    }

    // Block deletion of other admins.
    const { data: tgtProfile } = await supabase
      .from('profiles').select('role').eq('user_id', targetId).maybeSingle()
    if (tgtProfile?.role === 'admin') {
      return res.status(400).json({ error: 'Refusing to delete another admin account.' })
    }

    const tables = [
      'goals', 'journal_entries', 'reflections',
      'lc_conversations', 'programs', 'pseudonym_registry',
      'profiles',
    ]
    const results = {}
    for (const table of tables) {
      const { error, count } = await supabase
        .from(table).delete({ count: 'exact' }).eq('user_id', targetId)
      results[table] = error ? { error: error.message } : { deleted: count ?? 0 }
    }

    // Finally, drop the auth.users row. After this the email is reusable
    // and any token the user still holds is rejected on the next request.
    const { error: authErr } = await supabase.auth.admin.deleteUser(targetId)
    if (authErr) {
      return res.status(500).json({ error: `App data deleted but auth.users delete failed: ${authErr.message}`, results })
    }

    res.json({ ok: true, results })
  } catch (err) {
    console.error('[route-error]', req.method, req.originalUrl, err?.message)
    res.status(err.status || 500).json({ error: err.publicMessage || 'Server error.' })
  }
})

module.exports = router
