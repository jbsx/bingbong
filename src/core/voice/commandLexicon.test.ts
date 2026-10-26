import { describe, expect, it } from 'vitest'
import { CLOUD_KEYTERM_LIMIT, CLOUD_KEYTERM_MAX_CHARS } from './cloudKeyterms'
import { commandHeads, commandLexicon } from './commandLexicon'

// The grammar's heads (#471): one short term per verb and view the app
// answers to, lifted from the command tables, never a hand list.

describe('commandHeads', () => {
  const heads = commandHeads()

  it('carries every view and the verbs the owner says over a watch page, each once, each a single short word', () => {
    for (const head of ['idle', 'dashboard', 'weight', 'settings', 'panel', 'loop', 'back', 'volume', 'pause', 'help', 'flag', 'scroll', 'click', 'read', 'timer', 'dismiss'])
      expect(heads, head).toContain(head)
    expect(new Set(heads).size).toBe(heads.length)
    for (const head of heads) {
      expect(head).toMatch(/^[a-z]+$/)
      expect(head.length).toBeLessThanOrEqual(CLOUD_KEYTERM_MAX_CHARS)
    }
  })

  it('seats the app\'s own words first and the typed grammar\'s and the dismiss verbs last, so the budget cuts those first', () => {
    expect(heads.indexOf('idle')).toBeLessThan(heads.indexOf('click'))
    expect(heads.indexOf('click')).toBeLessThan(heads.indexOf('loop'))
    expect(heads.indexOf('loop')).toBeLessThan(heads.indexOf('screenshot'))
    expect(heads.indexOf('screenshot')).toBeLessThan(heads.indexOf('dismiss'))
  })

  it('leaves out a function word, a single letter and the off side of a toggle: that of "that was wrong", x of the dismiss glyph, unmute', () => {
    for (const junk of ['that', 'x', 'no', 'unmute', 'unloop', 'unpause', 'uncaptions']) expect(heads).not.toContain(junk)
  })

  it('fits the cap on its own, and every head is a word of the seed', () => {
    expect(heads.length).toBeLessThanOrEqual(CLOUD_KEYTERM_LIMIT)
    const seedWords = new Set(commandLexicon().flatMap((phrase) => phrase.split(' ')).concat(['idle', 'dashboard', 'weight', 'settings']))
    for (const head of heads) expect(seedWords, head).toContain(head)
  })
})

describe('commandLexicon', () => {
  it('lifts the Flag\'s heads with the rest', () => {
    expect(commandLexicon()).toContain('flag that')
  })
})
