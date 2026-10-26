import type { BiasPhraseSet } from '../moonshine/contextualBiasing.ts'

// The cloud ear's keyterms (#463, grill ruling 8; the budget #471): the
// names the decode is biased toward, sent to ElevenLabs' realtime model,
// which takes at most 50 terms of at most 20 characters each. The Learned
// Terms first, then the grammar's heads (commandLexicon.ts: one short term
// per verb and view the app answers to), then the Page Terms to the cap.
// Page Terms came first until 2026-10-26, when a YouTube watch page's 64
// filled all 50 and 'idle page' was heard 'Title page' five times: the
// ear had never been told the app's own words. The Seed Lexicon as a whole
// is not sent: 207 of its 220 phrases fit the length and none the budget,
// so its rank is the heads. A term over the length is left out, not
// shortened: a cut name biases toward a word nobody says.

/** ElevenLabs Scribe v2 Realtime's keyterm caps (docs, 2026-10-26). */
export const CLOUD_KEYTERM_LIMIT = 50
export const CLOUD_KEYTERM_MAX_CHARS = 20

/** A word that is a number, a count or a clock time: `3`, `17k`, `4:18`, `17,814`, `1.5x`. */
const COUNT_WORD_RE = /^[\d.,:]+[a-z]{0,2}$/

/**
 * Whether a Page Term is worth a keyterm slot (#471): a name, not a bare
 * number, a count or a clock time (`3`, `17k`, `4:18` — every word a
 * count), and not a single word of under five letters, which on a page is a
 * control's label (`sign`, `save`, `turn`, `mix`) that the ear hears
 * unbiased, where a name of five (`MKBHD`, `niyam`) is worth the slot. The
 * five-letter line is a guess: the measured arm had no Page Term slot
 * left to tell, and `pnpm stt:gate` is where it would.
 */
export function keytermPageTerm(term: string): boolean {
  const words = term.split(' ')
  if (words.every((word) => COUNT_WORD_RE.test(word))) return false
  return words.length > 1 || term.length >= 5
}

/**
 * The keyterms for one Utterance, from the bias the decode reads: the
 * boosted set is the Page Terms (ADR 0077), the plain one the Bias Lexicon
 * — the Seed Lexicon's terms and the Learned Terms after them, told apart
 * by the seed. The Learned Terms, then the heads, then the Page Terms that
 * pass {@link keytermPageTerm}, cut at the cap from the end.
 */
export function cloudKeyterms(bias: readonly string[] | readonly BiasPhraseSet[], seed: ReadonlySet<string>, heads: readonly string[]): string[] {
  const sets: readonly BiasPhraseSet[] = bias.length > 0 && typeof bias[0] === 'string' ? [{ phrases: bias as readonly string[] }] : (bias as readonly BiasPhraseSet[])
  const page = sets.filter((set) => set.boost !== undefined).flatMap((set) => set.phrases)
  const lexicon = sets.filter((set) => set.boost === undefined).flatMap((set) => set.phrases)
  const learned = lexicon.filter((term) => !seed.has(term))
  const terms: string[] = []
  const seen = new Set<string>()
  for (const raw of [...learned, ...heads, ...page.filter(keytermPageTerm)]) {
    const term = raw.trim()
    const key = term.toLowerCase()
    if (term === '' || term.length > CLOUD_KEYTERM_MAX_CHARS || seen.has(key)) continue
    seen.add(key)
    terms.push(term)
    if (terms.length === CLOUD_KEYTERM_LIMIT) break
  }
  return terms
}
