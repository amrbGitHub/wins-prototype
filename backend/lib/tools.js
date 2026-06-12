// Action tools for LC, exposed to the LLM in Anthropic tool-call format
// (adapters translate to OpenAI / Gemini equivalents).
//
// Two execution models live side-by-side:
//
// 1. Frontend-executed tools (create_goal, update_goal, delete_goal, log_win,
//    create_program, navigate). The model emits one; the response goes back
//    to the frontend; the frontend hits the CRUD endpoint. On the NEXT turn,
//    the gateway reconstructs synthetic tool_use + tool_result pairs in
//    history so the model sees concrete proof prior calls executed.
//
// 2. Server-resolved tools (search_web). The gateway runs the call mid-turn,
//    appends the assistant tool_use + user tool_result inline, and calls the
//    model again — looping until the model emits no more server-resolved
//    tools (capped at MAX_TOOL_HOPS). Lets the model ground its final
//    answer in the search results rather than waiting a full turn for them.
//
// Text fields in any input contain pseudonyms (Person_4F2C, Org_AD92, ...)
// — the gateway rehydrates them back to real names before dispatching.
// search_web queries are an exception: they MUST be PII-free at the source
// so we never leak real names to Tavily.

const SERVER_RESOLVED_TOOL_NAMES = new Set(['search_web'])

// Tool descriptions are sent on every turn (not covered by the system-prompt
// cache), so prose is kept tight. Behavior guidance ("when to use", playbooks)
// lives in the system prompt's cached static block, not here.
const LC_TOOLS = [
  {
    name: 'create_goal',
    description: "Create a goal. Shape it first — title alone is too thin; include description with success criteria and target date when possible.",
    input_schema: {
      type: 'object',
      properties: {
        title:       { type: 'string', description: 'Short title, max ~8 words.' },
        description: { type: 'string', description: 'Success criteria + concrete steps.' },
        targetDate:  { type: 'string', description: 'YYYY-MM-DD.' },
        programRef:  { type: 'string', description: 'Program name if tied to one.' },
      },
      required: ['title'],
    },
  },

  {
    name: 'update_goal',
    description: "Modify one existing goal. Send only changed fields. For renames put the new title in `title`. goalRef fuzzy-matches by title/fragment.",
    input_schema: {
      type: 'object',
      properties: {
        goalRef:     { type: 'string', description: 'Title or fragment to match.' },
        title:       { type: 'string', description: 'New title (rename only).' },
        description: { type: 'string' },
        progress:    { type: 'integer', minimum: 0, maximum: 100 },
        status:      { type: 'string', enum: ['active', 'completed', 'shelved'] },
        targetDate:  { type: 'string', description: 'YYYY-MM-DD.' },
      },
      required: ['goalRef'],
    },
  },

  {
    name: 'delete_goal',
    description: "Delete a goal permanently. Only on explicit remove/delete request.",
    input_schema: {
      type: 'object',
      properties: {
        goalRef: { type: 'string', description: 'Title or fragment.' },
      },
      required: ['goalRef'],
    },
  },

  {
    name: 'log_win',
    description: "Log a celebration win. Title centers on whoever the win belongs to (trainer OR learner).",
    input_schema: {
      type: 'object',
      properties: {
        title:            { type: 'string', description: 'Short, max ~8 words.' },
        story:            { type: 'string', description: '1–2 sentences.' },
        evidence:         { type: 'string', description: 'One concrete observed detail.' },
        celebrationIdeas: { type: 'array', items: { type: 'string' }, description: '1–3 ideas.' },
        programRef:       { type: 'string' },
      },
      required: ['title', 'story'],
    },
  },

  {
    name: 'create_program',
    description: "Create a program (cohort/workshop/intensive). Never on first mention — shape audience, format, timeline first. Need name + 2 of {description, startDate, endDate, learnerCount}.",
    input_schema: {
      type: 'object',
      properties: {
        name:         { type: 'string' },
        description:  { type: 'string' },
        startDate:    { type: 'string', description: 'YYYY-MM-DD.' },
        endDate:      { type: 'string', description: 'YYYY-MM-DD.' },
        learnerCount: { type: 'integer', minimum: 1 },
      },
      required: ['name'],
    },
  },

  {
    name: 'search_web',
    description: "Search the open web for L&D research/frameworks/current facts. Server runs it and returns results in this turn — cite them in your prose. CRITICAL: queries must be PII-free (no names of people/orgs/places, no pseudonyms). Phrase around concepts.",
    input_schema: {
      type: 'object',
      properties: {
        query:      { type: 'string', description: 'PII-free query, 3–12 words.' },
        maxResults: { type: 'integer', minimum: 1, maximum: 10, description: 'Default 5.' },
      },
      required: ['query'],
    },
  },

  {
    name: 'navigate',
    description: "Suggest a page; the user sees a button. Use when next step belongs in the UI.",
    input_schema: {
      type: 'object',
      properties: {
        view:  { type: 'string', enum: ['goals', 'celebrate', 'reflections', 'programs', 'home'] },
        label: { type: 'string', description: 'Short CTA text.' },
      },
      required: ['view'],
    },
  },
]

function isServerResolvedTool(name) {
  return SERVER_RESOLVED_TOOL_NAMES.has(name)
}

module.exports = { LC_TOOLS, isServerResolvedTool, SERVER_RESOLVED_TOOL_NAMES }
