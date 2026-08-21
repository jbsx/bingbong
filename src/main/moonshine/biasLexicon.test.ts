import { describe, expect, it } from 'vitest'
import { BIAS_LEXICON } from './biasLexicon'

// The bias lexicon is data (#62): the only edit site when a mishear is
// discovered — the decode code never changes. These tests pin the seed
// contract (the app's own vocabulary is present) and the hygiene the
// applier's normalization relies on, so extending the list never breaks
// them but rotting an entry does.

describe('BIAS_LEXICON', () => {
  it('seeds the app vocabulary: panel, dock, overlay, Settings names, navigation words', () => {
    for (const term of [
      'panel',
      'feed panel',
      'dock',
      'overlay',
      'wider',
      'forward',
      'wake word',
      'endpoint delay',
      'web zoom',
      'adblock',
      'model routing',
    ]) {
      expect(BIAS_LEXICON).toContain(term)
    }
  })

  it('holds normalized, unique terms only', () => {
    expect(BIAS_LEXICON.length).toBeGreaterThan(0)
    expect(new Set(BIAS_LEXICON).size).toBe(BIAS_LEXICON.length)
    for (const term of BIAS_LEXICON) {
      expect(term).toBe(term.toLowerCase().trim().split(/\s+/).join(' '))
    }
  })
})
