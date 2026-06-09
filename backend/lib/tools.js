// Action tools for LC, exposed to Claude/DeepSeek in Anthropic tool-call format.
//
// The model can choose to invoke any of these alongside its prose response.
// Each emitted tool_use becomes an action in the chat response; the frontend
// executes it via the existing CRUD endpoints. On the NEXT turn, the gateway
// reconstructs synthetic tool_use + tool_result pairs in history so the model
// sees concrete proof the call already ran and does not re-emit it.
//
// Text fields in any input contain pseudonyms (Person_4F2C, Org_AD92, ...)
// — the gateway rehydrates them back to real names before dispatching.

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

module.exports = { LC_TOOLS }
