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

const LC_TOOLS = [
  {
    name: 'create_goal',
    description:
      "Create a new goal for the user. Use when they explicitly want one — e.g. " +
      "\"add a goal to X\". Shape the goal in conversation first: a bare title isn't " +
      "enough; aim for a clear description with success criteria and ideally a target " +
      "date. If the user mentions a program, pass its name in programRef.",
    input_schema: {
      type: 'object',
      properties: {
        title:       { type: 'string', description: 'Short goal title, max ~8 words.' },
        description: { type: 'string', description: '1–2 sentences with success criteria and concrete steps.' },
        targetDate:  { type: 'string', description: 'Due date in YYYY-MM-DD if the user gave one.' },
        programRef:  { type: 'string', description: 'Program name the goal is tied to, if any.' },
      },
      required: ['title'],
    },
  },

  {
    name: 'update_goal',
    description:
      "Modify ONE existing goal. Use exactly the fields the user asked to change " +
      "— omit the rest. For renames, put the NEW title in `title` (NOT a reference). " +
      "Identify the target goal via goalRef (its title or a fragment); the server " +
      "fuzzy-matches.",
    input_schema: {
      type: 'object',
      properties: {
        goalRef:     { type: 'string', description: 'Title or fragment of the goal to update.' },
        title:       { type: 'string', description: 'New title (for renames only).' },
        description: { type: 'string' },
        progress:    { type: 'integer', minimum: 0, maximum: 100, description: 'Progress %, 0–100.' },
        status:      { type: 'string', enum: ['active', 'completed', 'shelved'] },
        targetDate:  { type: 'string', description: 'YYYY-MM-DD.' },
      },
      required: ['goalRef'],
    },
  },

  {
    name: 'delete_goal',
    description:
      "Permanently delete a goal. Only use when the user explicitly asks to remove/delete. " +
      "Identify via goalRef.",
    input_schema: {
      type: 'object',
      properties: {
        goalRef: { type: 'string', description: 'Title or fragment of the goal to delete.' },
      },
      required: ['goalRef'],
    },
  },

  {
    name: 'log_win',
    description:
      "Log a celebration win to the user's journal. Use when they describe something " +
      "that went well — for themselves OR for a learner they witnessed. Center the title " +
      "on whoever the win really belongs to.",
    input_schema: {
      type: 'object',
      properties: {
        title:            { type: 'string', description: 'Short win title, max ~8 words.' },
        story:            { type: 'string', description: '1–2 sentences describing what happened.' },
        evidence:         { type: 'string', description: 'Concrete observed detail (1 sentence).' },
        celebrationIdeas: { type: 'array', items: { type: 'string' }, description: '1–3 ideas for how to celebrate.' },
        programRef:       { type: 'string', description: 'Program the win is tied to, if any.' },
      },
      required: ['title', 'story'],
    },
  },

  {
    name: 'create_program',
    description:
      "Create a new program (cohort, workshop series, intensive). NEVER emit on the " +
      "first mention — spend 2–3 shaping turns first covering audience, format, and " +
      "timeline. Required: name + at least 2 of {description, startDate, endDate, " +
      "learnerCount}. The server rejects programs with insufficient shape and rejects " +
      "duplicates by fuzzy-matching against existing programs.",
    input_schema: {
      type: 'object',
      properties: {
        name:         { type: 'string', description: 'Short program name.' },
        description:  { type: 'string', description: 'One-line description.' },
        startDate:    { type: 'string', description: 'YYYY-MM-DD.' },
        endDate:      { type: 'string', description: 'YYYY-MM-DD.' },
        learnerCount: { type: 'integer', minimum: 1 },
      },
      required: ['name'],
    },
  },

  {
    name: 'search_web',
    description:
      "Search the open web for current L&D research, frameworks, or facts you " +
      "aren't confident about. Use this BEFORE citing claims that could be out " +
      "of date, when the user asks for sources, or when a specific number / " +
      "study would strengthen the answer. The server runs the search and feeds " +
      "results back to you in the SAME turn — you'll see the results and can " +
      "cite them in your final prose. " +
      "CRITICAL: queries must be PII-free — never include personal names, " +
      "organization names, or place names. Phrase around the concept instead " +
      "(e.g. 'manager reinforcement post-training transfer research', not " +
      "'how is Person_4F2C's cohort doing'). Pseudonyms have no meaning to " +
      "search engines and would leak real names if rehydrated.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Plain-English web search query, PII-free, 3–12 words.' },
        maxResults: { type: 'integer', minimum: 1, maximum: 10, description: 'How many results to return (default 5).' },
      },
      required: ['query'],
    },
  },

  {
    name: 'navigate',
    description:
      "Suggest moving to a specific page in the app. Unlike other actions this " +
      "requires the user to click — they see a button labeled `label`. Use when " +
      "the conversation has reached a point where the next step is best done in " +
      "the UI (e.g. \"open Goals to see them all\").",
    input_schema: {
      type: 'object',
      properties: {
        view:  { type: 'string', enum: ['goals', 'celebrate', 'reflections', 'programs', 'home'] },
        label: { type: 'string', description: 'Short CTA text shown on the button.' },
      },
      required: ['view'],
    },
  },
]

function isServerResolvedTool(name) {
  return SERVER_RESOLVED_TOOL_NAMES.has(name)
}

module.exports = { LC_TOOLS, isServerResolvedTool, SERVER_RESOLVED_TOOL_NAMES }
