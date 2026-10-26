import { describe, expect, it } from 'vitest'
import { CLOUD_KEYTERM_LIMIT, CLOUD_KEYTERM_MAX_CHARS, cloudKeyterms, keytermPageTerm } from './cloudKeyterms'
import { commandHeads } from './commandLexicon'

// The cloud ear's keyterm budget (#471): the Learned Terms, then the
// grammar's heads, then the Page Terms to the cap of 50, each at most 20
// characters. A YouTube watch page yields 64 Page Terms, and sent first
// they starved the ear of every app word: 'idle page' was heard 'Title
// page' five times on 2026-10-26.

const SEED = new Set(['play', 'pause', 'idle screen', 'show idle'])
const HEADS = ['idle', 'settings', 'play', 'pause', 'loop', 'back']

/** The 64 Page Terms of the Iraada watch page of 2026-10-26, as the ear got them live (ledger turn-mvphyxti-vm). */
const WATCH_PAGE = [
  'niyam', 'iraada', 'tum se tum tak', 'mix', '3', 'youtube', 'settings', 'sign', 'save', 'leave', 'turn', 'barsaat', 'playlist',
  '2 minutes 4 seconds', '4 minutes 18 seconds', 'mc stan tanmay bhat', 'go x husn x', 'music level remember', 'mile jo sukoon',
  'dooron dooron live', 'voice notes concert', 'coke studio bharat', 'husn mashup extended', 'youtube home', 'search search',
  'niyam subscribe', 'share share', 'niyam 2', 'iraada 4', '320 comments', 'afsana much', 'will reach', 'hamza malik', 'zain zohaib',
  'official visualiser', 'aarzu ep', 'lyric visualiser', 'cortisol reset', 'calm mind', 'stop overthinking', 'indian healing',
  'paresh pahuja', 'pal pal', '10 songs', 'niyam reaction', 'maan panu', 'anuv jain', 'sid guldekar', '4:18', '17,814',
  ...Array.from({ length: 14 }, (_, i) => `channel ${i}`),
]

describe('cloudKeyterms', () => {
  it('puts the Learned Terms first, then the heads, then the Page Terms', () => {
    const bias = [{ phrases: ['play', 'pause', 'idle screen', 'niyam', 'tum se tum tak'] }, { phrases: ['Linus Tech Tips', 'MKBHD'], boost: 1.5 }]
    expect(cloudKeyterms(bias, SEED, HEADS)).toEqual(['niyam', 'tum se tum tak', ...HEADS, 'Linus Tech Tips', 'MKBHD'])
  })

  it('reads a plain phrase list as the lexicon: its Learned Terms, then the heads', () => {
    expect(cloudKeyterms(['joji', 'play'], SEED, HEADS)).toEqual(['joji', ...HEADS])
  })

  it('leaves out a term over 20 characters and a repeat, whatever its case', () => {
    const bias = [{ phrases: ['niyam'] }, { phrases: ['Tum Se Tum Tak - Niyam (Official Video)', 'Niyam', ' '], boost: 1.5 }]
    expect(cloudKeyterms(bias, SEED, ['Pause'])).toEqual(['niyam', 'Pause'])
  })

  it('on a 64-term watch page carries the Learned Terms and every head before any Page Term, at most 50 of at most 20 characters', () => {
    const learned = ['tum se tum tak', 'niyam', 'iraada', 'michael bublé', 'feeling good', 'joji', '50 cent', 'many men', 'highs and lows', 'ye']
    const bias = [{ phrases: ['play', 'pause', ...learned] }, { phrases: WATCH_PAGE, boost: 1.5 }]
    const terms = cloudKeyterms(bias, SEED, HEADS)
    expect(terms.slice(0, learned.length + HEADS.length)).toEqual([...learned, ...HEADS])
    expect(terms).toHaveLength(CLOUD_KEYTERM_LIMIT)
    expect(terms.every((term) => term.length <= CLOUD_KEYTERM_MAX_CHARS)).toBe(true)
    expect(terms).toContain('idle')
    expect(terms).toContain('coke studio bharat')
  })

  it('cuts at 50 from the end: the Page Terms first, then the heads, never a Learned Term', () => {
    const learned = Array.from({ length: 45 }, (_, i) => `learned ${i}`)
    const terms = cloudKeyterms([{ phrases: ['play', ...learned] }, { phrases: WATCH_PAGE, boost: 1.5 }], SEED, HEADS)
    expect(terms).toHaveLength(CLOUD_KEYTERM_LIMIT)
    expect(terms.slice(0, 45)).toEqual(learned)
    expect(terms.slice(45)).toEqual(HEADS.slice(0, 5))
  })

  it('the seed itself is never a keyterm: its rank is the heads', () => {
    expect(cloudKeyterms([{ phrases: ['play', 'pause', 'idle screen'] }], SEED, HEADS)).toEqual(HEADS)
  })

  it('with the heads the app lifts, a 64-term page still carries idle, settings and loop and no bare count', () => {
    const terms = cloudKeyterms([{ phrases: ['play', 'tum se tum tak'] }, { phrases: WATCH_PAGE, boost: 1.5 }], SEED, commandHeads())
    expect(terms[0]).toBe('tum se tum tak')
    expect(terms).toHaveLength(CLOUD_KEYTERM_LIMIT)
    for (const head of ['idle', 'settings', 'loop', 'pause', 'back', 'help']) expect(terms).toContain(head)
    for (const junk of ['3', '4:18', '17,814', 'sign', 'save', 'turn']) expect(terms).not.toContain(junk)
  })
})

describe('keytermPageTerm', () => {
  it('keeps a name and drops a bare number, a count, a clock time and a single short word', () => {
    for (const kept of ['coke studio bharat', 'niyam 2', '320 comments', 'youtube', 'barsaat', 'mkbhd', 'leave']) expect(keytermPageTerm(kept)).toBe(true)
    for (const dropped of ['3', '17k', '4:18', '17,814', '1.5x', 'sign', 'save', 'turn', 'mix']) expect(keytermPageTerm(dropped)).toBe(false)
  })
})
