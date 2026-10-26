import { describe, expect, it } from 'vitest'
import { CLOUD_KEYTERM_LIMIT, cloudKeyterms } from './cloudKeyterms'

// The cloud ear's keyterms (#463, grill ruling 8): Page Terms, then Learned
// Terms, then the Seed Lexicon, at most 50 of at most 20 characters.

const SEED = new Set(['play', 'pause', 'idle screen'])

describe('cloudKeyterms', () => {
  it('puts the Page Terms first, then the Learned Terms, then the seed', () => {
    const bias = [{ phrases: ['play', 'pause', 'idle screen', 'niyam', 'tum se tum tak'] }, { phrases: ['Linus Tech Tips', 'MKBHD'], boost: 1.5 }]
    expect(cloudKeyterms(bias, SEED)).toEqual(['Linus Tech Tips', 'MKBHD', 'niyam', 'tum se tum tak', 'play', 'pause', 'idle screen'])
  })

  it('reads a plain phrase list as the lexicon', () => {
    expect(cloudKeyterms(['joji', 'play'], SEED)).toEqual(['joji', 'play'])
  })

  it('leaves out a term over 20 characters and a repeat, whatever its case', () => {
    const bias = [{ phrases: ['niyam'] }, { phrases: ['Tum Se Tum Tak - Niyam (Official Video)', 'Niyam', ' '], boost: 1.5 }]
    expect(cloudKeyterms(bias, SEED)).toEqual(['Niyam'])
  })

  it('cuts at 50, the seed losing first', () => {
    const page = Array.from({ length: 30 }, (_, i) => `page ${i}`)
    const learned = Array.from({ length: 30 }, (_, i) => `learned ${i}`)
    const terms = cloudKeyterms([{ phrases: ['play', ...learned] }, { phrases: page, boost: 1.5 }], SEED)
    expect(terms).toHaveLength(CLOUD_KEYTERM_LIMIT)
    expect(terms.slice(0, 30)).toEqual(page)
    expect(terms.at(-1)).toBe('learned 19')
    expect(terms).not.toContain('play')
  })
})
