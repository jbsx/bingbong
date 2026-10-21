import { describe, expect, it } from 'vitest'
import { idleKeyAction, idlePromptText, type IdleKeyInput } from './idleKey'

const key = (over: Partial<IdleKeyInput>): IdleKeyInput => ({ type: 'keyDown', key: 'a', control: false, meta: false, alt: false, isComposing: false, ...over })

describe('idleKeyAction (#361)', () => {
  it('types a printable key: a letter, a capital, a digit, punctuation, a non-Latin letter', () => {
    for (const k of ['a', 'G', '7', '?', 'é', 'ж']) expect(idleKeyAction(key({ key: k }))).toEqual({ kind: 'type', text: k })
  })

  it('opens the Prompt empty on Space', () => {
    expect(idleKeyAction(key({ key: ' ' }))).toEqual({ kind: 'open' })
  })

  it('swallows a key that types nothing, and its key up', () => {
    for (const k of ['PageUp', 'PageDown', 'Home', 'End', 'Enter', 'Escape', 'Tab', 'Backspace', 'ArrowDown', 'F5', 'Shift']) {
      expect(idleKeyAction(key({ key: k }))).toEqual({ kind: 'swallow' })
    }
    expect(idleKeyAction(key({ type: 'keyUp', key: 'PageUp' }))).toEqual({ kind: 'swallow' })
  })

  it('passes a chord — a shortcut — and an IME composition on', () => {
    expect(idleKeyAction(key({ control: true }))).toEqual({ kind: 'pass' })
    expect(idleKeyAction(key({ meta: true, key: 'PageUp' }))).toEqual({ kind: 'pass' })
    expect(idleKeyAction(key({ alt: true }))).toEqual({ kind: 'pass' })
    expect(idleKeyAction(key({ isComposing: true }))).toEqual({ kind: 'pass' })
  })

  it("opens the Prompt with a typed key's character, empty for Space, and not at all for the rest", () => {
    expect(idlePromptText(idleKeyAction(key({ key: 's' })))).toBe('s')
    expect(idlePromptText(idleKeyAction(key({ key: ' ' })))).toBe('')
    expect(idlePromptText(idleKeyAction(key({ key: 'PageDown' })))).toBeNull()
    expect(idlePromptText(idleKeyAction(key({ control: true })))).toBeNull()
  })
})
