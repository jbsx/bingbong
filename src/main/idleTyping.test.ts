import { describe, expect, it } from 'vitest'
import { isIdleTypingKey } from './idleTyping'

const key = (over: Partial<Electron.Input>) =>
  ({ type: 'keyDown', key: 'a', control: false, meta: false, shift: false, alt: false, isComposing: false, ...over }) as Electron.Input

describe('isIdleTypingKey', () => {
  it('is a printable key: a letter, a capital, a digit, punctuation, a non-Latin letter', () => {
    for (const k of ['a', 'G', '7', '?', 'é', 'ж']) expect(isIdleTypingKey(key({ key: k }))).toBe(true)
  })

  it('is not whitespace, a named key, a chord, a key up or an IME composition', () => {
    expect(isIdleTypingKey(key({ key: ' ' }))).toBe(false)
    expect(isIdleTypingKey(key({ key: 'Enter' }))).toBe(false)
    expect(isIdleTypingKey(key({ key: 'Escape' }))).toBe(false)
    expect(isIdleTypingKey(key({ key: 'ArrowDown' }))).toBe(false)
    expect(isIdleTypingKey(key({ control: true }))).toBe(false)
    expect(isIdleTypingKey(key({ meta: true }))).toBe(false)
    expect(isIdleTypingKey(key({ alt: true }))).toBe(false)
    expect(isIdleTypingKey(key({ type: 'keyUp' }))).toBe(false)
    expect(isIdleTypingKey(key({ isComposing: true }))).toBe(false)
  })
})
