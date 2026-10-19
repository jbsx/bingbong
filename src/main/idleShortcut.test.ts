import { describe, expect, it } from 'vitest'
import { isIdleShortcut } from './idleShortcut'

const key = (over: Partial<Electron.Input>) => ({ type: 'keyDown', key: 'L', control: true, meta: false, shift: true, alt: false, ...over }) as Electron.Input

describe('isIdleShortcut', () => {
  it('is Ctrl+Shift+L, or Cmd+Shift+L', () => {
    expect(isIdleShortcut(key({}))).toBe(true)
    expect(isIdleShortcut(key({ key: 'l' }))).toBe(true)
    expect(isIdleShortcut(key({ control: false, meta: true }))).toBe(true)
  })

  it('is nothing else: no shift, an alt, another key, a key up', () => {
    expect(isIdleShortcut(key({ shift: false }))).toBe(false)
    expect(isIdleShortcut(key({ alt: true }))).toBe(false)
    expect(isIdleShortcut(key({ control: false }))).toBe(false)
    expect(isIdleShortcut(key({ key: 'F' }))).toBe(false)
    expect(isIdleShortcut(key({ type: 'keyUp' }))).toBe(false)
  })
})
