import { describe, expect, it } from 'vitest'
import { BIAS_LEXICON } from './biasLexicon'

// The bias lexicon is data (#62): the only edit site when a mishear is
// discovered — the decode code never changes. These tests pin the seed
// contract (the app's own vocabulary is present) and the hygiene the
// applier's normalization relies on, so extending the list never breaks
// them but rotting an entry does.

describe('BIAS_LEXICON', () => {
  it("seeds this branch's vocabulary: the CLI grammar's verbs, Settings names, navigation words (#335)", () => {
    for (const term of [
      'scroll',
      'scroll up',
      'scroll down',
      'click',
      'read',
      'press',
      'screenshot',
      'navigate',
      'back',
      'forward',
      'reload',
      'close',
      'close the pop-up',
      'dismiss',
      'resume',
      'wake word',
      'endpoint delay',
      'web zoom',
      'web',
      'adblock',
      'dashboard',
    ]) {
      expect(BIAS_LEXICON).toContain(term)
    }
  })

  it('lifts no orchestrator-era or Feed Panel sizing word, each a near-tie no Command uses (#335)', () => {
    for (const term of [
      'orchestrator',
      'subagent',
      'tool rounds',
      'model routing',
      'panel',
      'feed panel',
      'dock',
      'docked',
      'dock mode',
      'overlay',
      'overlay mode',
      'collapsed',
      'wider',
      'narrower',
      'half screen',
      'panel mode',
      'panel width',
      'pop up',
    ]) {
      expect(BIAS_LEXICON).not.toContain(term)
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
