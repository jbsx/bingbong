import { describe, expect, it } from 'vitest'
import { earPhase, partialSpans, quietLine } from './voicePrompt'

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

describe('earPhase', () => {
  const ear = (listening: boolean, transcribing: boolean, monitoring: boolean) => ({ listening, transcribing, monitoring })

  it('is at rest while only the wake word listens', () => {
    expect(earPhase(ear(false, false, true))).toBe('rest')
  })

  it('is listening only while an Utterance is taken, and transcribing once its words are being read', () => {
    expect(earPhase(ear(true, false, true))).toBe('listening')
    expect(earPhase(ear(false, true, true))).toBe('transcribing')
  })

  it('says the microphone is off when nothing listens, not even for the wake word', () => {
    expect(earPhase(ear(false, false, false))).toBe('off')
  })

  it('is at rest before main has said anything', () => {
    expect(earPhase(null)).toBe('rest')
  })
})
