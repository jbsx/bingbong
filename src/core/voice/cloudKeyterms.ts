import type { BiasPhraseSet } from '../moonshine/contextualBiasing.ts'

// The cloud ear's keyterms (#463, grill ruling 8): the names the decode is
// biased toward, sent to ElevenLabs' realtime model, which takes at most
// 50 terms of at most 20 characters each. Page Terms first, then Learned
// Terms, then the Seed Lexicon, cut at the cap. A term over the length is
// left out, not shortened: a cut name biases toward a word nobody says.

/** ElevenLabs Scribe v2 Realtime's keyterm caps (docs, 2026-10-26). */
export const CLOUD_KEYTERM_LIMIT = 50
export const CLOUD_KEYTERM_MAX_CHARS = 20

/**
 * The keyterms for one Utterance, from the bias the decode reads: the
 * boosted set is the Page Terms (ADR 0077), the plain one the Bias Lexicon
 * — the Seed Lexicon's terms and the Learned Terms after them, told apart
 * by the seed.
 */
export function cloudKeyterms(bias: readonly string[] | readonly BiasPhraseSet[], seed: ReadonlySet<string>): string[] {
  const sets: readonly BiasPhraseSet[] = bias.length > 0 && typeof bias[0] === 'string' ? [{ phrases: bias as readonly string[] }] : (bias as readonly BiasPhraseSet[])
  const page = sets.filter((set) => set.boost !== undefined).flatMap((set) => set.phrases)
  const lexicon = sets.filter((set) => set.boost === undefined).flatMap((set) => set.phrases)
  const learned = lexicon.filter((term) => !seed.has(term))
  const seeded = lexicon.filter((term) => seed.has(term))
  const terms: string[] = []
  const seen = new Set<string>()
  for (const raw of [...page, ...learned, ...seeded]) {
    const term = raw.trim()
    const key = term.toLowerCase()
    if (term === '' || term.length > CLOUD_KEYTERM_MAX_CHARS || seen.has(key)) continue
    seen.add(key)
    terms.push(term)
    if (terms.length === CLOUD_KEYTERM_LIMIT) break
  }
  return terms
}
