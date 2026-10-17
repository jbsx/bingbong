import { describe, expect, it } from 'vitest'
import { nameMatch, soundKey, soundsAlike, wordSoundKey } from './nameMatch'

// The Name Match (ADR 0077, #325): a Slot that sounds like a name the page
// shows, or one the user taught the app, is carried as that name. The
// cases are the owner's own replay of 2026-10-17: "Linus Tech Tips" came
// out of the recogniser five ways in one session.

describe('soundKey', () => {
  it('keys a word by its consonant classes, vowels dropped after the first letter', () => {
    expect(wordSoundKey('Linus')).toBe('LNS')
    expect(wordSoundKey('tech')).toBe('TX')
    expect(wordSoundKey('tips')).toBe('TPS')
    expect(wordSoundKey('dips')).toBe('TPS')
    expect(wordSoundKey('Elon')).toBe('ALN')
    expect(wordSoundKey('knight')).toBe('NT')
    expect(wordSoundKey('phone')).toBe('FN')
    expect(wordSoundKey('2025')).toBe('2025')
  })

  it('runs the words together so a moved word boundary costs nothing', () => {
    expect(soundKey('line stack tips')).toBe('LNSTKTPS')
    expect(soundKey('Linus Tech Tips')).toBe('LNSTXTPS')
    expect(soundKey("Elon Musk's")).toBe('ALNMSKS')
  })
})

describe('nameMatch', () => {
  const candidates = ['Linus Tech Tips', 'Elon Musk', 'Marques Brownlee', 'YouTube']

  it('carries the on-screen spelling for each way the recogniser heard the name', () => {
    for (const heard of ['line stack tips', 'Linus Tech dips', 'liner stack tips']) {
      expect(nameMatch(heard, candidates)).toEqual({ slot: 'Linus Tech Tips', candidate: 'Linus Tech Tips', heard })
    }
  })

  it('replaces only the span that sounds like the name, keeping the words around it as spoken', () => {
    expect(nameMatch('line stack tips laptop review', candidates)).toEqual({
      slot: 'Linus Tech Tips laptop review',
      candidate: 'Linus Tech Tips',
      heard: 'line stack tips',
    })
  })

  it('leaves a Slot alone that already carries a candidate as spelled', () => {
    expect(nameMatch('linus tech tips', candidates)).toBeNull()
    expect(nameMatch('open youtube', candidates)).toBeNull()
  })

  it('leaves words alone that sound like no candidate', () => {
    expect(nameMatch('line of tactics', candidates)).toBeNull()
    expect(nameMatch('rust async book', candidates)).toBeNull()
    expect(nameMatch('hello', candidates)).toBeNull()
  })

  it('matches nothing on a key too short to tell names apart', () => {
    expect(nameMatch('tip', ['Tips'])).toBeNull()
  })

  it('prefers the nearer candidate, and the first on a tie', () => {
    expect(nameMatch('linus tech dips', ['Linus Tech Tipps', 'Linus Tech Tips'])?.candidate).toBe('Linus Tech Tipps')
    expect(nameMatch('line stack tips', ['Linus Tech Tips', 'Linus Tech Tipz'])?.candidate).toBe('Linus Tech Tips')
  })

  it('reads a possessive as the name it inflects', () => {
    expect(nameMatch("Elon Musk's profile", candidates)).toEqual({ slot: 'Elon Musk profile', candidate: 'Elon Musk', heard: "Elon Musk's" })
  })
})

describe('soundsAlike', () => {
  it('holds within one edit per four key characters', () => {
    expect(soundsAlike('line of factors', 'line of tactics')).toBe(true)
    expect(soundsAlike('linus tech dips', 'linus tech tips')).toBe(true)
    expect(soundsAlike('line of tactics', 'linus tech tips')).toBe(false)
    expect(soundsAlike('cats', 'dogs')).toBe(false)
  })
})
