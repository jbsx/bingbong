// The Off-language Answer (#286, ADR 0034): an Answer is written in
// English, the product's one language, and one whose Card or Spoken
// Rendering has more than half of its letters outside Latin script is never
// rendered. Script share, not language detection: over the 727 renderings
// on disk when the rule was set the one bad Card read 64% and every other
// 0%, and a detector is least reliable on a two-sentence Spoken Rendering.
// The rule is one pure function over a rendering's text, so the app and the
// Round Audit judge by the same one.

/** The share of letters outside Latin script above which a rendering is off-language. */
export const OFF_LANGUAGE_SHARE = 0.5

const LETTER = /\p{L}/u
const LATIN_LETTER = /\p{Script=Latin}/u

/** A rendering's letters, how many are outside Latin script, and their share. */
export interface LetterShare {
  readonly letters: number
  readonly nonLatin: number
  /** `nonLatin` over `letters`; 0 for a rendering with no letters. */
  readonly share: number
}

/**
 * The letters of a rendering by script. Only letters count: digits,
 * punctuation, whitespace and markdown's own marks are none, so a Card of
 * dates and links reads the same as its prose alone would.
 */
export function nonLatinLetterShare(text: string): LetterShare {
  let letters = 0
  let nonLatin = 0
  for (const char of text) {
    if (!LETTER.test(char)) continue
    letters += 1
    if (!LATIN_LETTER.test(char)) nonLatin += 1
  }
  return { letters, nonLatin, share: letters === 0 ? 0 : nonLatin / letters }
}

/** Whether a rendering is off-language: more than half of its letters outside Latin script. An empty one passes. */
export function isOffLanguageRendering(text: string): boolean {
  return nonLatinLetterShare(text).share > OFF_LANGUAGE_SHARE
}

/** Which of an Answer's two renderings failed, by the glossary's names. */
export type OffLanguageRendering = 'card' | 'spoken'

/** One rendering that failed the rule, and the share it failed at. */
export interface OffLanguageFinding {
  readonly rendering: OffLanguageRendering
  readonly share: number
}

/**
 * The renderings of an Answer that are off-language, the Card first. Each
 * is judged on its own, and the Answer is an Off-language Answer when the
 * list is not empty. Asked Items and Subagent Reports are never judged.
 */
export function offLanguageRenderings(answer: { readonly display: string; readonly speak: string }): OffLanguageFinding[] {
  const renderings: readonly [OffLanguageRendering, string][] = [
    ['card', answer.display],
    ['spoken', answer.speak],
  ]
  return renderings.flatMap(([rendering, text]) => (isOffLanguageRendering(text) ? [{ rendering, share: nonLatinLetterShare(text).share }] : []))
}

/**
 * The Answer contract's one sentence about language (#286), in the
 * orchestrator prompt only. It is prevention: the rule above is what holds.
 */
export const ANSWER_LANGUAGE_INSTRUCTION = 'Write "speak" and "display" in English, whatever language the pages you read are in.'

/**
 * The Answer Retry's message for an Off-language Answer (#286): what was
 * wrong, and the same Answer asked for again. It translates nothing itself
 * — the runtime never writes the user's Answer.
 */
export const OFF_LANGUAGE_RETRY_MESSAGE =
  'Your last reply was the Answer but was not written in English. Reply with the same Answer in English: only the JSON object, "speak" and "display" in English.'
