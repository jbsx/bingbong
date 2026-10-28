import { describe, expect, it } from 'vitest'
import { earPhase, earWaitLine, earWaitParts, partialSpans, quietLine, waitSeconds, wordlessLine } from './voicePrompt'

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
  const ear = (listening: boolean, transcribing: boolean, monitoring: boolean, hearing = false) => ({ listening, transcribing, monitoring, hearing })

  it('is at rest while only the wake word listens', () => {
    expect(earPhase(ear(false, false, true))).toBe('rest')
  })

  it('is listening only while an Utterance is taken, and transcribing once its words are being read', () => {
    expect(earPhase(ear(true, false, true))).toBe('listening')
    expect(earPhase(ear(false, true, true))).toBe('transcribing')
  })

  it('is hearing from the frame speech starts in the Utterance being taken (#441), and transcribing outranks it', () => {
    expect(earPhase(ear(true, false, true, true))).toBe('hearing')
    expect(earPhase(ear(false, true, true, true))).toBe('transcribing')
  })

  it('says the microphone is off when nothing listens, not even for the wake word', () => {
    expect(earPhase(ear(false, false, false))).toBe('off')
  })

  it('is at rest before main has said anything', () => {
    expect(earPhase(null)).toBe('rest')
  })

  it('is at rest while the app speaks into an open ear that has heard nothing — only the wake word is heard then (#472)', () => {
    expect(earPhase({ ...ear(true, false, true), speaking: true })).toBe('rest')
    expect(earPhase({ ...ear(true, false, false), speaking: true })).toBe('off')
    expect(earPhase({ ...ear(true, false, true, true), speaking: true })).toBe('hearing')
    expect(earPhase({ ...ear(false, true, true), speaking: true })).toBe('transcribing')
    expect(earPhase({ ...ear(true, false, true), speaking: false })).toBe('listening')
  })

  it('listens while the app speaks when it hears the person over it (#490)', () => {
    expect(earPhase({ ...ear(true, false, true), speaking: true, overSpeech: true })).toBe('listening')
    expect(earPhase({ ...ear(false, false, true), speaking: true, overSpeech: true })).toBe('rest')
  })
})

describe('wordlessLine', () => {
  it('asks for a command until speech starts, then says "…" until the first partial (#441)', () => {
    expect(wordlessLine('listening')).toBe('say a command')
    expect(wordlessLine('hearing')).toBe('…')
    expect(wordlessLine('transcribing')).toBe('…')
  })
})

describe('earPhase at the cold start (#442)', () => {
  const ear = (open: Partial<{ listening: boolean; transcribing: boolean; monitoring: boolean }>, loading?: 'ear' | 'words' | 'failed') => ({
    listening: open.listening ?? false,
    transcribing: open.transcribing ?? false,
    monitoring: open.monitoring ?? false,
    hearing: false,
    ...(loading !== undefined ? { loading } : {}),
  })

  it('is starting while the ear cannot hear yet, whatever it is open for', () => {
    expect(earPhase(ear({ monitoring: true }, 'ear'))).toBe('starting')
    expect(earPhase(ear({ listening: true }, 'ear'))).toBe('starting')
  })

  it('is off, not starting, with the microphone off: nothing loads until it opens', () => {
    expect(earPhase(ear({}, 'ear'))).toBe('off')
  })

  it('hears as ever while only the transcriber is loading, and holds a line taken then as still starting', () => {
    expect(earPhase(ear({ monitoring: true }, 'words'))).toBe('rest')
    expect(earPhase(ear({ listening: true, monitoring: true }, 'words'))).toBe('listening')
    expect(earPhase(ear({ transcribing: true, monitoring: true }, 'words'))).toBe('starting')
    expect(earPhase(ear({ transcribing: true, monitoring: true }))).toBe('transcribing')
  })
})

describe('earPhase after a failed load (#447)', () => {
  const ear = (open: Partial<{ listening: boolean; transcribing: boolean; monitoring: boolean }>) => ({
    listening: open.listening ?? false,
    transcribing: open.transcribing ?? false,
    monitoring: open.monitoring ?? false,
    hearing: false,
    loading: 'failed' as const,
  })

  it('is failed, not starting, open or shut — the wait has ended, and a monitor stopped by the fault is no microphone switched off', () => {
    expect(earPhase(ear({}))).toBe('failed')
    expect(earPhase(ear({ monitoring: true }))).toBe('failed')
  })

  it('says a listen or a read under way as ever: a failed wake word leaves Ctrl+Space an ear that hears', () => {
    expect(earPhase(ear({ listening: true, monitoring: true }))).toBe('listening')
    expect(earPhase(ear({ transcribing: true }))).toBe('transcribing')
  })
})

describe('waitSeconds', () => {
  it('counts whole seconds from the phase start on the caller’s clock, never below zero', () => {
    expect(waitSeconds(10_000, 12_999)).toBe(2)
    expect(waitSeconds(10_000, 9_000)).toBe(0)
    expect(waitSeconds(undefined, 12_999)).toBe(0)
  })
})

describe('earWaitLine (#442)', () => {
  it('names the ear loading and its seconds at the cold start', () => {
    expect(earWaitLine('starting', { partial: '', since: 1_000 }, 4_200)).toBe('loading the ear · 3s')
  })

  it('names the words being read, or "your words", with the seconds in the phase', () => {
    expect(earWaitLine('transcribing', { partial: 'what about the weather', since: 1_000 }, 2_100)).toBe('“what about the weather” · 1s')
    expect(earWaitLine('transcribing', { partial: '', since: 1_000 }, 1_400)).toBe('your words · 0s')
  })

  it('names the line a starting ear holds, with the seconds since its Endpoint', () => {
    expect(earWaitLine('starting', { partial: '', transcribing: true, since: 1_000 }, 3_000)).toBe('your words · 2s')
  })

  it('keeps the seconds apart from the object, so a short line ellipsizes the words and never the count', () => {
    expect(earWaitParts('transcribing', { partial: 'next song', since: 0 }, 12_000)).toEqual({ object: '“next song”', tail: ' · 12s' })
  })
})
