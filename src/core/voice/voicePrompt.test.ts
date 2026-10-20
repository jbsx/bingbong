import { describe, expect, it } from 'vitest'
import { partialSpans, quietLine } from './voicePrompt'

// The Voice Prompt's live words (#359): the partial transcript, a Page Term in it marked.

describe('partialSpans', () => {
  it('marks a Page Term the words carry, whatever its case', () => {
    expect(partialSpans('open the weather in london', ['London'])).toEqual([
      { text: 'open the weather in ', term: false },
      { text: 'london', term: true },
    ])
  })

  it('marks a term only as whole words', () => {
    expect(partialSpans('play londoner songs', ['London'])).toEqual([{ text: 'play londoner songs', term: false }])
  })

  it('takes the longest term where two start at the same word', () => {
    expect(partialSpans('open Linus Tech Tips now', ['Linus', 'Linus Tech Tips'])).toEqual([
      { text: 'open ', term: false },
      { text: 'Linus Tech Tips', term: true },
      { text: ' now', term: false },
    ])
  })

  it('is the words alone with no terms', () => {
    expect(partialSpans('scroll down', [])).toEqual([{ text: 'scroll down', term: false }])
  })
})

describe('quietLine', () => {
  it('says what ends the Utterance: the turn check, or the Pause cap of quiet (#357)', () => {
    expect(quietLine(2000)).toBe('ends when you finish — 2 s at most')
    expect(quietLine(1250)).toBe('ends when you finish — 1.25 s at most')
    expect(quietLine(700)).toBe('ends when you finish — 0.7 s at most')
  })
})
