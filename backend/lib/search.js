// Tavily search adapter. Single thin wrapper around the Tavily REST API.
// Used by the gateway when the LLM emits a search_web tool call.
//
// Returns a normalized shape so future swaps to Brave / Exa / native
// Anthropic web_search are a one-file change.
//
// Env: TAVILY_API_KEY — get one (free tier) at tavily.com. Missing key
// is treated as a graceful failure: the tool call returns an explanatory
// error string the model can incorporate into prose ("search is currently
// unavailable, here's what I know from training instead"). The chat turn
// never fails just because search is misconfigured.

const TAVILY_URL = 'https://api.tavily.com/search'
const DEFAULT_MAX_RESULTS = 5
const REQUEST_TIMEOUT_MS = 12_000

function getApiKey() {
  return process.env.TAVILY_API_KEY || ''
}

function isConfigured() {
  return !!getApiKey()
}

// Returns { query, results: [{title, url, snippet}] } or throws.
async function tavilySearch(query, { maxResults = DEFAULT_MAX_RESULTS } = {}) {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY not configured on the server. Web search is unavailable.')
  }
  const q = String(query || '').trim()
  if (!q) throw new Error('Empty search query.')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const resp = await fetch(TAVILY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key:        apiKey,
        query:          q,
        max_results:    Math.min(Math.max(1, Number(maxResults) || DEFAULT_MAX_RESULTS), 10),
        search_depth:   'basic',          // 'advanced' is 2x credits, basic is enough for L&D queries
        include_answer: false,            // we want the model to synthesize; raw snippets are enough
        include_images: false,
      }),
      signal: controller.signal,
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new Error(`Tavily HTTP ${resp.status}: ${body.slice(0, 200)}`)
    }
    const data = await resp.json()
    const results = Array.isArray(data?.results) ? data.results : []
    return {
      query: q,
      results: results.map(r => ({
        title:   r.title   || '',
        url:     r.url     || '',
        snippet: r.content || '',
      })),
    }
  } finally {
    clearTimeout(timer)
  }
}

// Format Tavily results as the tool_result content string the LLM sees.
// Numbered so the model can cite [1], [2], etc. in its prose.
function formatResultsForModel(searchResult) {
  if (!searchResult.results?.length) {
    return `No results found for "${searchResult.query}". Tell the user web search returned nothing useful and offer to answer from general knowledge instead.`
  }
  return [
    `Search query: ${searchResult.query}`,
    '',
    'Results:',
    ...searchResult.results.map((r, i) =>
      `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet}`
    ),
    '',
    'Cite specific results inline using their bracketed number — e.g. "manager support is the strongest L3 predictor [2]." Do not invent citations.',
  ].join('\n')
}

module.exports = { tavilySearch, formatResultsForModel, isConfigured }
