import type { BiasPhraseSet } from '../moonshine/contextualBiasing'

// The bias input the decoder reads for one Utterance (ADR 0077, #325): the
// Bias Lexicon — Seed Lexicon and Learned Terms, the app's lasting
// vocabulary — and the Page Terms of the page the Utterance is spoken
// over, which change at every speech start. Two sets, so the page's names
// can be lifted less than the app's own words: a name the page shows is
// likely but not certain to be what was said. The array identity is
// stable until one of the halves changes, so the transcriber rebuilds its
// phrase tries only then.

/** How much a Page Term lifts a piece, against the Bias Lexicon's default. */
export const PAGE_TERMS_BOOST = 1.5

export interface BiasUnion {
  /** The sets the decoder biases toward now. */
  phrases(): readonly BiasPhraseSet[]
  /** The Page Terms of the page spoken over, from speech start until the next; empty clears them. */
  setPageTerms(terms: readonly string[]): void
  /** The Page Terms in force. */
  pageTerms(): readonly string[]
}

export function createBiasUnion(deps: {
  /** The Bias Lexicon, identity-stable between ledger changes. */
  lexicon(): readonly string[]
  pageTermsBoost?: number
}): BiasUnion {
  const boost = deps.pageTermsBoost ?? PAGE_TERMS_BOOST
  let page: readonly string[] = []
  let built: { lexicon: readonly string[]; page: readonly string[]; sets: readonly BiasPhraseSet[] } | null = null
  return {
    phrases() {
      const lexicon = deps.lexicon()
      if (built === null || built.lexicon !== lexicon || built.page !== page) {
        const sets: BiasPhraseSet[] = []
        if (lexicon.length > 0) sets.push({ phrases: lexicon })
        if (page.length > 0) sets.push({ phrases: page, boost })
        built = { lexicon, page, sets }
      }
      return built.sets
    },
    setPageTerms(terms) {
      page = terms
    },
    pageTerms: () => page,
  }
}
