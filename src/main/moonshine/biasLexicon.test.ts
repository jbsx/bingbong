import { describe, expect, it } from 'vitest'
import { BIAS_LEXICON } from './biasLexicon'

// The bias lexicon (#62): the command half built from the tables the app
// answers by (#456), the names half by hand. These tests pin that every
// kind of command word is lifted by class — the grammar's, the Local
// Match's, the Player's, the media ops', the card's — and the hygiene the
// applier's normalization relies on.

describe('BIAS_LEXICON', () => {
  it('lifts every kind of command word the app answers to (#456)', () => {
    for (const term of [
      // The CLI grammar and the Local Match (#335)
      'scroll',
      'scroll up',
      'scroll down',
      'click',
      'press',
      'screenshot',
      'navigate',
      'back',
      'forward',
      'reload',
      'resume',
      'go back',
      'search',
      // The Player's lines: the words heard wrong on 2026-10-25/26
      'play',
      'loop',
      'loop this song',
      'repeat',
      'volume',
      'mute',
      'skip',
      'play from the beginning',
      // The Media Ops' labels and done words (#372)
      'captions',
      'stop looping',
      // The dismiss phrases (#336): "close" was heard as "Closer." and "Clothes"
      'close',
      'close it',
      'close the pop up',
      'dismiss',
      // The card's ref-less labels: the Appliance Verbs and the app's options (#374, #420)
      'play next',
      'previous',
      'panel open',
      'panel close',
      'show settings',
    ]) {
      expect(BIAS_LEXICON).toContain(term)
    }
  })

  it('keeps the names no command table says (#335)', () => {
    for (const term of ['wake word', 'endpoint delay', 'web zoom', 'web', 'adblock', 'dashboard', 'idle screen']) {
      expect(BIAS_LEXICON).toContain(term)
    }
  })

  it('lifts no orchestrator-era word, each a near-tie no Command uses (#335)', () => {
    for (const term of ['orchestrator', 'subagent', 'tool rounds', 'model routing', 'dock mode', 'overlay mode', 'half screen', 'panel mode']) {
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
