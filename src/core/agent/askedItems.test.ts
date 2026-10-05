import { describe, expect, it } from 'vitest'
import {
  ASKED_ITEM_UNESTABLISHED,
  ASKED_ITEM_UNSTATED,
  askedItemsCoverage,
  askedItemsRetryMessage,
  mergeAskedItems,
  parseAskedItemEntries,
  settleAskedItems,
} from './askedItems'

const ENTRY_FORM =
  '{"n": the item\'s number in the declared list, "standing": "stated" or "unverified", "statement": the established value alone, or why you could not}'

const DECLARED = ['smallest reduction to carried items that fits the allowance', 'the guitar']

describe('an Asked Item entry named by number (#311)', () => {
  it('parses `n` in place of `item` or beside it, and refuses an entry with neither', () => {
    expect(parseAskedItemEntries([{ n: 1, standing: 'stated', statement: 'Drop the bag.' }])).toEqual([{ n: 1, standing: 'stated', statement: 'Drop the bag.' }])
    expect(parseAskedItemEntries([{ n: '2', item: 'guitar', standing: 'stated', statement: 'One piece.' }])).toEqual([
      { n: 2, item: 'guitar', standing: 'stated', statement: 'One piece.' },
    ])
    expect(parseAskedItemEntries([{ standing: 'stated', statement: 'Drop the bag.' }])).toBeNull()
    expect(parseAskedItemEntries([{ n: 'first', standing: 'stated', statement: 'Drop the bag.' }])).toBeNull()
  })

  it('covers the item it numbers whatever its wording says', () => {
    const entries = [
      { n: 1, item: 'smallest reduction to carried items that fits', standing: 'stated', statement: 'Drop the bag.' },
      { n: 2, item: 'something else entirely', standing: 'stated', statement: 'One piece.' },
    ] as const
    expect(askedItemsCoverage(DECLARED, entries)).toEqual({ missing: [], undeclared: [] })
    expect(settleAskedItems(DECLARED, entries)).toEqual([
      { item: DECLARED[0], standing: 'stated', statement: 'Drop the bag.' },
      { item: 'the guitar', standing: 'stated', statement: 'One piece.' },
    ])
  })

  it('still matches an entry without `n` by its wording', () => {
    const entries = [{ item: 'The Guitar.', standing: 'stated', statement: 'One piece.' }] as const
    expect(askedItemsCoverage(DECLARED, entries)).toEqual({ missing: [DECLARED[0]], undeclared: [] })
  })

  it('makes an entry undeclared when its `n` is out of range or already used, even when its wording matches', () => {
    const entries = [
      { n: 2, item: 'the guitar', standing: 'stated', statement: 'One piece.' },
      { n: 2, item: 'smallest reduction to carried items that fits the allowance', standing: 'stated', statement: 'Drop the bag.' },
      { n: 3, item: 'the guitar', standing: 'stated', statement: 'Again.' },
      { n: 0, standing: 'stated', statement: 'Nothing.' },
    ] as const
    const coverage = askedItemsCoverage(DECLARED, entries)
    expect(coverage.missing).toEqual([DECLARED[0]])
    expect(coverage.undeclared).toEqual([`#2 ${DECLARED[0]}`, '#3 the guitar', '#0'])
    expect(settleAskedItems(DECLARED, entries)).toEqual([
      { item: DECLARED[0], standing: 'unverified', statement: ASKED_ITEM_UNSTATED },
      { item: 'the guitar', standing: 'stated', statement: 'One piece.' },
    ])
  })
})

describe('the list-only reply merged into the Answer (#311)', () => {
  const held = [{ item: 'the guitar', standing: 'stated', statement: 'One piece.' }, { item: 'the fare', standing: 'stated', statement: '£50.' }] as const

  it('takes the reply’s entries, and keeps a held standing for an item the reply left out', () => {
    const merged = mergeAskedItems(DECLARED, held, [{ n: 1, standing: 'unverified', statement: 'The allowance page did not load.' }])
    expect(askedItemsCoverage(DECLARED, merged)).toEqual({ missing: [], undeclared: [] })
    expect(settleAskedItems(DECLARED, merged)).toEqual([
      { item: DECLARED[0], standing: 'unverified', statement: 'The allowance page did not load.' },
      { item: 'the guitar', standing: 'stated', statement: 'One piece.' },
    ])
  })

  it('lets the reply’s standing replace the held one for the same item', () => {
    const merged = mergeAskedItems(DECLARED, held, [{ n: 2, standing: 'unverified', statement: 'Not confirmed.' }])
    expect(settleAskedItems(DECLARED, merged)[1]).toEqual({ item: 'the guitar', standing: 'unverified', statement: 'Not confirmed.' })
  })

  it('keeps the held list as written when the reply carries none', () => {
    expect(mergeAskedItems(DECLARED, held, null)).toEqual(held)
    expect(mergeAskedItems(DECLARED, undefined, null)).toBeUndefined()
  })
})

describe('the Asked Items retry message (#311)', () => {
  const coverage = { missing: [DECLARED[0]], undeclared: ['the fare'] }

  it('asks a readable Answer for the list alone, naming each missing item by number and wording', () => {
    const message = askedItemsRetryMessage(DECLARED, coverage, 'list')
    expect(message).toContain(`1. "${DECLARED[0]}"`)
    expect(message).toContain('"the fare"')
    expect(message).toContain('{"asked_items": [...]}')
    expect(message).toContain(ENTRY_FORM)
    expect(message).not.toContain('"item"')
    expect(message).toMatch(/stands as written/)
    expect(message).not.toMatch(/only the JSON object,/)
  })

  it('asks a prose reply for the whole Answer, describing the numbered form', () => {
    const message = askedItemsRetryMessage(DECLARED, { missing: DECLARED, undeclared: [] }, 'prose')
    expect(message).toMatch(/was not the JSON object, so it carries no "asked_items"/)
    expect(message).toContain('Reply with only the JSON object')
    expect(message).toContain(`1. "${DECLARED[0]}"; 2. "the guitar"`)
    expect(message).toContain(ENTRY_FORM)
    expect(message).not.toContain('"item"')
  })
})

// #313, ADR 0074: the prompt stopped asking for the item's wording, and
// nothing about reading an entry changed with it.
describe('an Asked Item entry written the old way (#313)', () => {
  const numbered = [
    { n: 2, item: 'the guitar', standing: 'stated', statement: 'One piece.' },
    { n: 1, item: DECLARED[0], standing: 'unverified', statement: 'The allowance page did not load.' },
  ] as const
  const worded = [
    { item: 'The Guitar.', standing: 'stated', statement: 'One piece.' },
    { item: DECLARED[0], standing: 'unverified', statement: 'The allowance page did not load.' },
  ] as const
  const settled = [
    { item: DECLARED[0], standing: 'unverified', statement: 'The allowance page did not load.' },
    { item: 'the guitar', standing: 'stated', statement: 'One piece.' },
  ]

  it('parses, matches and settles an entry carrying `item` beside its `n`', () => {
    expect(parseAskedItemEntries(numbered.map((entry) => ({ ...entry })))).toEqual(numbered)
    expect(askedItemsCoverage(DECLARED, numbered)).toEqual({ missing: [], undeclared: [] })
    expect(settleAskedItems(DECLARED, numbered)).toEqual(settled)
  })

  it('parses, matches and settles an entry without `n` by its wording', () => {
    expect(parseAskedItemEntries(worded.map((entry) => ({ ...entry })))).toEqual(worded)
    expect(askedItemsCoverage(DECLARED, worded)).toEqual({ missing: [], undeclared: [] })
    expect(askedItemsCoverage(DECLARED, [{ item: 'the fare', standing: 'stated', statement: '£50.' }])).toEqual({ missing: DECLARED, undeclared: ['the fare'] })
    expect(settleAskedItems(DECLARED, worded)).toEqual(settled)
  })

  it('merges a held list and a reply written either way', () => {
    // The reply's entries as written, then the held standing named as declared.
    expect(mergeAskedItems(DECLARED, [worded[0]], [numbered[1]])).toEqual([numbered[1], { item: 'the guitar', standing: 'stated', statement: 'One piece.' }])
    expect(mergeAskedItems(DECLARED, [numbered[0]], [worded[1]])).toEqual([worded[1], { item: 'the guitar', standing: 'stated', statement: 'One piece.' }])
    expect(settleAskedItems(DECLARED, mergeAskedItems(DECLARED, [worded[0]], [numbered[1]]))).toEqual(settled)
    expect(settleAskedItems(DECLARED, mergeAskedItems(DECLARED, [numbered[0]], [worded[1]]))).toEqual(settled)
  })
})

describe('an Asked Item entry as the prompt asks for it (#313)', () => {
  it('is named on the Card by its declared wording, which it does not carry', () => {
    expect(settleAskedItems(DECLARED, [{ n: 2, standing: 'stated', statement: 'one piece' }, { n: 1, standing: 'stated', statement: 'drop the bag' }])).toEqual([
      { item: DECLARED[0], standing: 'stated', statement: 'drop the bag' },
      { item: 'the guitar', standing: 'stated', statement: 'one piece' },
    ])
  })
})

describe('the reason a deterministic Answer gives every Asked Item (#315)', () => {
  it('says the item is not established and names no stop', () => {
    expect(ASKED_ITEM_UNESTABLISHED).toBe('not established')
  })
})
