import { describe, expect, it } from 'vitest'
import { createBiasUnion, PAGE_TERMS_BOOST } from './biasUnion'

// The bias input for one Utterance (ADR 0077, #325): the Bias Lexicon at
// the default lift and the Page Terms at a lesser one, identity-stable
// until either half changes.

describe('createBiasUnion', () => {
  it('offers the lexicon alone until Page Terms are set, then both as two sets', () => {
    let lexicon: readonly string[] = ['panel', 'dock']
    const union = createBiasUnion({ lexicon: () => lexicon })
    expect(union.phrases()).toEqual([{ phrases: ['panel', 'dock'] }])

    union.setPageTerms(['linus tech tips'])
    expect(union.phrases()).toEqual([{ phrases: ['panel', 'dock'] }, { phrases: ['linus tech tips'], boost: PAGE_TERMS_BOOST }])
    expect(union.pageTerms()).toEqual(['linus tech tips'])

    lexicon = ['panel', 'dock', 'linus tech tips']
    expect(union.phrases()[0]).toEqual({ phrases: lexicon })
  })

  it('keeps the same array while nothing changed, so the decoder rebuilds nothing', () => {
    const lexicon = ['panel']
    const union = createBiasUnion({ lexicon: () => lexicon })
    const first = union.phrases()
    expect(union.phrases()).toBe(first)
    union.setPageTerms(['tesla'])
    const second = union.phrases()
    expect(second).not.toBe(first)
    expect(union.phrases()).toBe(second)
    union.setPageTerms([])
    expect(union.phrases()).toEqual([{ phrases: ['panel'] }])
  })

  it('is empty with no vocabulary at all', () => {
    expect(createBiasUnion({ lexicon: () => [] }).phrases()).toEqual([])
  })
})
