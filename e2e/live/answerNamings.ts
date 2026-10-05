// #323, dated note on ADR 0038: the Answers that name the stop. An Answer
// ends on the state of the task and never on how the Run was bounded, and
// nothing checks a model-written one in code — the words are ordinary
// English a user's own topic can carry. So the Round Audit counts them
// instead, from two phrase lists: the stop and the bound ("ran out of time",
// "before the budget closed", "my working time"), and beside it the
// application's internal names ("Session Evidence", "memory-4", "via
// subagent"). Reported, never gated; every hit is kept with the words around
// it, so a count can be read rather than trusted.
//
// The lists are the wordings the retained captures hold, read by hand on
// 2026-10-05: narrower than the test vocabulary of
// src/core/testing/stoppingPolicy.ts, which forbids "error", "retry" and a
// bare "budget" in the application's own sentences and would count a
// camera's `--timeout` flag here.

/** Where in the Answer a phrase was read. */
export type AnswerNamingPlace = 'speak' | 'display' | 'asked_item'

/** One phrase an Answer carried: where, the words matched, and the text around them. */
export interface AnswerNamingHit {
  readonly where: AnswerNamingPlace
  readonly phrase: string
  readonly excerpt: string
}

/** What one Answer names: the stop or the bound, and the application's internal names. */
export interface AnswerNamings {
  readonly stop: readonly AnswerNamingHit[]
  readonly internal: readonly AnswerNamingHit[]
}

/** The texts of one Answer the user met: the Spoken Rendering, the Card, and each Asked Item's statement. */
export interface AnswerTexts {
  readonly speak: string
  readonly display: string
  readonly statements: readonly string[]
}

/** What the Run spent, as an Answer words it. */
const SPENT = '(?:time|budget|rounds?|steps?|turns?|attempts?)'
/** What the Answer says ended. */
const BOUNDED = '(?:run|session|work|research|search|browsing|budget|deadline|working time|browsing time|browsing window)'
const ENDED = '(?:ended|stopped|closed|finished|expired|was (?:cut|over|exhausted|spent|stopped)|ran out)'

/**
 * The stop and the bound. A bare "budget" is not here: it is a verb in a
 * user's own topic ("budget several seconds per capture"), so it counts only
 * beside what it was a budget of or what became of it.
 */
export const STOP_NAMING_PHRASES: readonly RegExp[] = [
  new RegExp(`\\b(?:ran|run|running) out of (?:[a-z']+ ){0,2}${SPENT}\\b`, 'gi'),
  new RegExp(`\\b(?:time|budget|work|window) (?:ran|run|running) out\\b`, 'gi'),
  /\b(?:work|working|browsing|run|research|search|time|tool|round) budget\b/gi,
  /\brun['’]s budget\b/gi,
  new RegExp(`\\bbudget ${ENDED}`, 'gi'),
  /\bbudget exhaustion\b/gi,
  /\bdeadline\b/gi,
  /\b(?:working|browsing) time\b/gi,
  /\bbrowsing window\b/gi,
  /\b(?:time|work|round) limit\b/gi,
  new RegExp(`\\bbefore (?:the |this |my )?${BOUNDED} ${ENDED}`, 'gi'),
  new RegExp(`\\b${BOUNDED} ${ENDED} before\\b`, 'gi'),
  /\bwithin (?:this|the) run\b/gi,
  // The Finalize Instruction's own opening since #323, should an Answer repeat it.
  /\bno further (?:acquisition|browsing|research|searching) (?:is|was) possible\b/gi,
]

/**
 * The application's internal names: its glossary, its ids, its tools and
 * the fields of the Answer contract. "This run" and "this session" are the
 * application's unit of work, which a person who did the research by hand
 * would not name.
 */
export const INTERNAL_NAME_PHRASES: readonly RegExp[] = [
  /\bSession Evidence\b/gi,
  /\bEvidence Checkpoints?\b/gi,
  /\bWorking Memory\b/gi,
  /\bRun Plan\b/gi,
  /\bEffort Tier\b/gi,
  /\bAsked Items?\b/gi,
  /\bsub-?agents?\b/gi,
  /\bmemory-\d+\b/gi,
  /\btool rounds?\b/gi,
  /\bvision timed out\b/gi,
  /\breader proxy\b/gi,
  /\b(?:record_evidence|record_candidate|report_run_plan|read_page|ask_user)\b/gi,
  /\b(?:memory_patch|evidence_ids|finalization_cause|run_note|mishear_proposals|inspection_candidate_id)\b/gi,
  /\bthis (?:run|session)\b/gi,
]

const EXCERPT_BEFORE = 60
const EXCERPT_AFTER = 40

function hitsIn(where: AnswerNamingPlace, text: string, phrases: readonly RegExp[]): AnswerNamingHit[] {
  const found: { at: number; hit: AnswerNamingHit }[] = []
  for (const phrase of phrases) {
    for (const match of text.matchAll(phrase)) {
      const at = match.index
      // One hit per place in the text: two phrases that read the same words are one naming.
      if (found.some((other) => at < other.at + other.hit.phrase.length && other.at < at + match[0].length)) continue
      const excerpt = text.slice(Math.max(0, at - EXCERPT_BEFORE), at + match[0].length + EXCERPT_AFTER).replace(/\s+/g, ' ').trim()
      found.push({ at, hit: { where, phrase: match[0], excerpt } })
    }
  }
  return found.sort((left, right) => left.at - right.at).map((entry) => entry.hit)
}

/** What one Answer's texts name, in the order the user met them. */
export function answerNamingsIn(answer: AnswerTexts): AnswerNamings {
  const places: readonly (readonly [AnswerNamingPlace, string])[] = [
    ['speak', answer.speak],
    ['display', answer.display],
    ...answer.statements.map((statement) => ['asked_item', statement] as const),
  ]
  return {
    stop: places.flatMap(([where, text]) => hitsIn(where, text, STOP_NAMING_PHRASES)),
    internal: places.flatMap(([where, text]) => hitsIn(where, text, INTERNAL_NAME_PHRASES)),
  }
}
