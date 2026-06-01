// Corpus of seeded PII-bearing messages for the redactor test suite.
//
// Each entry asserts:
//   - which substrings ("reals") MUST be redacted out (not present in the
//     Claude-bound payload), and
//   - optionally, which substrings MUST pass through unchanged (false-positive
//     traps — common L&D nouns that look like names).
//
// Add new entries here. Anyone on the cybersec team can extend this file
// without touching the test runner. Format documented at the bottom.

module.exports = [
  // ── Real PII that MUST be redacted ──────────────────────────────────────
  {
    name: 'single person name',
    input: 'Talk to James tomorrow.',
    mustRedact: ['James'],
    mustKeep:   [],
  },
  {
    name: 'two person names',
    input: 'Alex and Sarah cracked the feedback exercise.',
    mustRedact: ['Alex', 'Sarah'],
    mustKeep:   [],
  },
  {
    name: 'company + location',
    input: 'The Detroit office at Acme Corp ran a review.',
    mustRedact: ['Detroit', 'Acme Corp'],
    mustKeep:   [],
  },
  {
    name: 'project codename + city',
    input: 'Project Phoenix launches in Toronto next quarter.',
    mustRedact: ['Toronto'],     // "Project Phoenix" is ORG-ambiguous; treated as ORG
    mustKeep:   [],
  },
  {
    name: 'possessive form',
    input: "James's manager flagged the issue.",
    mustRedact: ['James'],
    mustKeep:   ["'s"],          // possessive marker must survive (rehydrator handles it)
  },
  {
    name: 'repeated name within message',
    input: 'James was struggling. I want to coach James next week.',
    mustRedact: ['James'],
    mustKeep:   [],
    // Additional assertion: both Jameses must map to the SAME pseudonym.
    intraConsistency: true,
  },

  // ── False-positive traps — L&D vocabulary that LOOKS like names ─────────
  {
    name: 'Kirkpatrick framework (not a person)',
    input: 'We ran a Kirkpatrick L3 review and saw transfer signals.',
    mustRedact: [],
    mustKeep:   ['Kirkpatrick'],  // it's a framework name, not a person
  },
  {
    name: 'Bloom\'s taxonomy (not a person)',
    input: "Use Bloom's taxonomy to write better learning objectives.",
    mustRedact: [],
    mustKeep:   ['Bloom'],
  },
  {
    name: 'no PII at all',
    input: 'I want to create a new program this month.',
    mustRedact: [],
    mustKeep:   ['program', 'create', 'month'],
  },

  // ── Real-world L&D conversation snippets ────────────────────────────────
  {
    name: 'coaching question with name',
    input: 'How can I coach Alex on giving feedback?',
    mustRedact: ['Alex'],
    mustKeep:   ['coach', 'feedback'],
  },
  {
    name: 'win description with multiple PII',
    input: 'Sarah from Acme Corp finally cracked the SBI framework in our Boston session.',
    mustRedact: ['Sarah', 'Acme Corp', 'Boston'],
    mustKeep:   ['SBI', 'framework', 'session'],
  },

  // ── Regression tests from real leaked-chat-log debugging ────────────────
  {
    // BERT tagged only "Am" of "Amro"; without word-boundary extension we'd
    // emit "Hey Person_XXXXro!" — both a leak and broken text.
    name: 'subword-truncated name (Amro)',
    input: 'Hey Amro! What would you like help with right now?',
    mustRedact: ['Amro'],
    mustKeep:   ['Hey', 'help'],
  },
  {
    // BERT scored "Jordan" at 0.83 — was being dropped by the 0.85 threshold.
    // Per-type thresholds (PERSON=0.70) fix this without losing precision.
    name: 'ambiguous-confidence name (Jordan)',
    input: 'Jordan and Priya both struggle with public speaking.',
    mustRedact: ['Jordan', 'Priya'],
    mustKeep:   ['public speaking'],
  },
]

// ── Entry format ──────────────────────────────────────────────────────────
// {
//   name:             string             // shown in test output
//   input:            string             // the user message
//   mustRedact:       string[]           // substrings that MUST NOT appear in redactedText
//   mustKeep:         string[]           // substrings that MUST still appear in redactedText
//   intraConsistency: boolean (optional) // if true, asserts repeated reals
//                                        // map to the SAME pseudonym
// }
