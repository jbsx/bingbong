import { describe, expect, it } from 'vitest'
import {
  applyMishearProposals,
  emptyLearnedTermsState,
  LEARNED_TERM_CAP,
  normalizeLearnedTerm,
  parseMishearProposals,
  sanitizeLearnedTermsState,
  touchLearnedTerms,
  type MishearProposal,
} from './learnedTerms'

// ADR 0022: the Bias Lexicon grows itself. The ledger is the app half of
// "the model proposes; the app disposes" — recurrence across Runs admits a
// term, removals apply immediately, and rejected terms can never walk back
// in on their own.

const NOW = 1_000
const SEED = new Set(['panel', 'dock'])

function add(repair: string, suspect = 'garbled'): MishearProposal {
  return { op: 'add', suspect, repair }
}

describe('applyMishearProposals', () => {
  it('a first proposal is a miss — recorded, admitted as nothing', () => {
    const { state, effects } = applyMishearProposals(emptyLearnedTermsState(), [add('linus tech tips')], NOW, SEED)
    expect(state.admitted).toEqual([])
    expect(state.pending.map((p) => p.term)).toEqual(['linus tech tips'])
    expect(effects).toEqual({ admitted: [], removed: [] })
  })

  it('the same proposal from a later Run admits the term', () => {
    const first = applyMishearProposals(emptyLearnedTermsState(), [add('linus tech tips')], NOW, SEED)
    const { state, effects } = applyMishearProposals(first.state, [add('Linus   Tech Tips')], NOW + 5_000, SEED)
    expect(state.pending).toEqual([])
    expect(state.admitted.map((t) => t.term)).toEqual(['linus tech tips'])
    expect(state.admitted[0]!.lastTouched).toBe(NOW + 5_000)
    expect(effects.admitted).toEqual(['linus tech tips'])
  })

  it('duplicate proposals inside one Run count once — recurrence is across Runs', () => {
    const first = applyMishearProposals(emptyLearnedTermsState(), [add('nguyen')], NOW, SEED)
    const { state } = applyMishearProposals(first.state, [add('nguyen'), add('nguyen'), add('nguyen')], NOW + 1, SEED)
    expect(state.admitted.map((t) => t.term)).toEqual(['nguyen'])
  })

  it('a proposal naming an admitted term touches it, not re-admits it', () => {
    const first = applyMishearProposals(emptyLearnedTermsState(), [add('nguyen')], NOW, SEED)
    const second = applyMishearProposals(first.state, [add('nguyen')], NOW + 1, SEED)
    const third = applyMishearProposals(second.state, [add('nguyen')], NOW + 60_000, SEED)
    expect(third.state.admitted).toHaveLength(1)
    expect(third.state.admitted[0]!.lastTouched).toBe(NOW + 60_000)
    expect(third.effects.admitted).toEqual([])
  })

  it('Seed Lexicon terms never become Learned Terms', () => {
    const { state } = applyMishearProposals(emptyLearnedTermsState(), [add('Panel'), add('panel')], NOW, SEED)
    expect(state.admitted).toEqual([])
    expect(state.pending).toEqual([])
  })

  it('rejected terms are invisible to proposals', () => {
    const base = emptyLearnedTermsState()
    base.rejected = ['nguyen']
    const { state } = applyMishearProposals(base, [add('nguyen'), add('nguyen')], NOW, SEED)
    expect(state.admitted).toEqual([])
    expect(state.pending).toEqual([])
    expect(state.rejected).toEqual(['nguyen'])
  })

  it('removals apply on first proposal — admitted and pending alike', () => {
    const base = emptyLearnedTermsState()
    base.admitted = [{ term: 'stinker', admittedAt: NOW, lastTouched: NOW }]
    base.pending = [{ term: 'maybe', at: NOW }]
    const { state, effects } = applyMishearProposals(base, [
      { op: 'remove', term: 'stinker' },
      { op: 'remove', term: 'maybe' },
    ], NOW + 1, SEED)
    expect(state.admitted).toEqual([])
    expect(state.pending).toEqual([])
    expect(state.rejected).toEqual([])
    expect(effects.removed).toEqual(['stinker'])
  })

  it('a Run may both remove and add — removal does not poison the repair', () => {
    const base = emptyLearnedTermsState()
    base.admitted = [{ term: 'pannel', admittedAt: NOW, lastTouched: NOW }]
    const { state } = applyMishearProposals(base, [
      { op: 'remove', term: 'pannel' },
      add('panel two'),
    ], NOW + 1, SEED)
    expect(state.admitted).toEqual([])
    expect(state.pending.map((p) => p.term)).toEqual(['panel two'])
  })

  it('terms longer than four words are dropped, never recorded', () => {
    const { state } = applyMishearProposals(emptyLearnedTermsState(), [add('one two three four five')], NOW, SEED)
    expect(state.pending).toEqual([])
    expect(state.admitted).toEqual([])
  })

  it('admission past the cap evicts the least-recently-touched term', () => {
    let state = emptyLearnedTermsState()
    for (let i = 0; i < LEARNED_TERM_CAP; i += 1) {
      const first = applyMishearProposals(state, [add(`term ${i}`)], NOW + i, SEED)
      state = applyMishearProposals(first.state, [add(`term ${i}`)], NOW + i, SEED).state
    }
    expect(state.admitted).toHaveLength(LEARNED_TERM_CAP)
    // `term 0` is stale; a fresh term's recurrence pushes it out.
    const missRun = applyMishearProposals(state, [add('fresh one')], NOW + 9_999, SEED)
    const { state: full } = applyMishearProposals(missRun.state, [add('fresh one')], NOW + 10_000, SEED)
    expect(full.admitted).toHaveLength(LEARNED_TERM_CAP)
    expect(full.admitted.map((t) => t.term)).not.toContain('term 0')
    expect(full.admitted.map((t) => t.term)).toContain('fresh one')
  })
})

describe('parseMishearProposals', () => {
  it('parses add and remove proposals, strict on keys', () => {
    expect(parseMishearProposals([
      { op: 'add', suspect: 'pedal', repair: 'panel' },
      { op: 'remove', term: 'pannel' },
    ])).toEqual([
      { op: 'add', suspect: 'pedal', repair: 'panel' },
      { op: 'remove', term: 'pannel' },
    ])
  })

  it('rejects the whole array on any malformed entry', () => {
    expect(parseMishearProposals([{ op: 'add', repair: 'panel' }])).toBeNull()
    expect(parseMishearProposals([{ op: 'add', suspect: 'x', repair: ' ' }])).toBeNull()
    expect(parseMishearProposals([{ op: 'remove' }])).toBeNull()
    expect(parseMishearProposals([{ op: 'nuke', term: 'panel' }])).toBeNull()
    expect(parseMishearProposals([{ op: 'remove', term: 'x', why: 'zzz' }])).toBeNull()
    expect(parseMishearProposals('nope')).toBeNull()
    expect(parseMishearProposals([])).toEqual([])
  })
})

describe('normalizeLearnedTerm', () => {
  it('lowercases, collapses whitespace, and bounds the word count', () => {
    expect(normalizeLearnedTerm('  Linus   Tech Tips ')).toBe('linus tech tips')
    expect(normalizeLearnedTerm('one two three four')).toBe('one two three four')
    expect(normalizeLearnedTerm('one two three four five')).toBeNull()
    expect(normalizeLearnedTerm('   ')).toBeNull()
  })
})

describe('touchLearnedTerms', () => {
  it('touches terms the transcript contains at word boundaries only', () => {
    const state = emptyLearnedTermsState()
    state.admitted = [
      { term: 'panel', admittedAt: 0, lastTouched: 0 },
      { term: 'dock', admittedAt: 0, lastTouched: 0 },
    ]
    const touched = touchLearnedTerms(state, 'Open the Panel please', 5_000)
    expect(touched.admitted.find((t) => t.term === 'panel')!.lastTouched).toBe(5_000)
    expect(touched.admitted.find((t) => t.term === 'dock')!.lastTouched).toBe(0)
    expect(touchLearnedTerms(state, 'open the panels', 9_000).admitted.find((t) => t.term === 'panel')!.lastTouched).toBe(0)
  })
})

describe('sanitizeLearnedTermsState', () => {
  it('fails closed to empty on garbage', () => {
    expect(sanitizeLearnedTermsState('{ not json')).toEqual(emptyLearnedTermsState())
    expect(sanitizeLearnedTermsState(null)).toEqual(emptyLearnedTermsState())
    expect(sanitizeLearnedTermsState({ pending: 'x' })).toEqual(emptyLearnedTermsState())
  })

  it('keeps valid entries and drops invalid ones without defaulting them in', () => {
    const state = sanitizeLearnedTermsState({
      pending: [{ term: 'nguyen', at: 1 }, { term: 'junk with five words total here', at: 2 }, 'junk'],
      admitted: [{ term: 'panel two', admittedAt: 1, lastTouched: 2 }, { term: 'nope' }],
      rejected: ['stinker', 42],
    })
    expect(state.pending).toEqual([{ term: 'nguyen', at: 1 }])
    expect(state.admitted).toEqual([{ term: 'panel two', admittedAt: 1, lastTouched: 2 }])
    expect(state.rejected).toEqual(['stinker'])
  })
})
