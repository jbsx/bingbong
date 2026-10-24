import { describe, expect, it } from 'vitest'
import { appMenuTemplate, shortcutOf } from './appShortcuts'

const key = (over: Partial<Electron.Input>) =>
  ({ type: 'keyDown', key: 'r', control: false, meta: false, shift: false, alt: false, ...over }) as Electron.Input

describe('shortcutOf', () => {
  it('reloads the page on Ctrl/Cmd+R or F5, and past the cache with Shift or Ctrl+F5', () => {
    expect(shortcutOf(key({ control: true }), 'linux')).toBe('reload')
    expect(shortcutOf(key({ key: 'R', meta: true }), 'darwin')).toBe('reload')
    expect(shortcutOf(key({ key: 'F5' }), 'linux')).toBe('reload')
    expect(shortcutOf(key({ key: 'R', control: true, shift: true }), 'linux')).toBe('hardReload')
    expect(shortcutOf(key({ key: 'F5', shift: true }), 'linux')).toBe('hardReload')
    expect(shortcutOf(key({ key: 'F5', control: true }), 'linux')).toBe('hardReload')
  })

  it('steps back and forward with Alt+Arrow, or Cmd+[ and Cmd+] on macOS', () => {
    expect(shortcutOf(key({ key: 'ArrowLeft', alt: true }), 'linux')).toBe('back')
    expect(shortcutOf(key({ key: 'ArrowRight', alt: true }), 'linux')).toBe('forward')
    expect(shortcutOf(key({ key: '[', meta: true }), 'darwin')).toBe('back')
    expect(shortcutOf(key({ key: ']', meta: true }), 'darwin')).toBe('forward')
    // Alt+Arrow moves a word in a macOS text field; Cmd+[ is nothing on Linux.
    expect(shortcutOf(key({ key: 'ArrowLeft', alt: true }), 'darwin')).toBeNull()
    expect(shortcutOf(key({ key: '[', control: true }), 'linux')).toBeNull()
  })

  it('arms listening on Ctrl/Cmd+Space', () => {
    expect(shortcutOf(key({ key: ' ', control: true }), 'linux')).toBe('listen')
    expect(shortcutOf(key({ key: ' ', meta: true }), 'darwin')).toBe('listen')
    expect(shortcutOf(key({ key: ' ', control: true, alt: true }), 'linux')).toBeNull()
  })

  it('opens the DevTools on Ctrl+Shift+I or F12, Cmd+Alt+I on macOS', () => {
    expect(shortcutOf(key({ key: 'I', control: true, shift: true }), 'linux')).toBe('devTools')
    expect(shortcutOf(key({ key: 'F12' }), 'linux')).toBe('devTools')
    expect(shortcutOf(key({ key: 'i', meta: true, alt: true }), 'darwin')).toBe('devTools')
  })

  it('is nothing for plain typing, editing chords, or a key up', () => {
    expect(shortcutOf(key({}), 'linux')).toBeNull()
    expect(shortcutOf(key({ key: ' ' }), 'linux')).toBeNull()
    expect(shortcutOf(key({ key: 'c', control: true }), 'linux')).toBeNull()
    expect(shortcutOf(key({ key: 'r', control: true, alt: true }), 'linux')).toBeNull()
    expect(shortcutOf(key({ type: 'keyUp', control: true }), 'linux')).toBeNull()
  })
})

describe('appMenuTemplate', () => {
  it('is no menu off macOS — no default accelerator reloads, zooms, closes or quits the appliance', () => {
    expect(appMenuTemplate('linux')).toBeNull()
    expect(appMenuTemplate('win32')).toBeNull()
  })

  it('keeps the app and Edit menus on macOS, where Cmd+C and Cmd+V need them', () => {
    expect(appMenuTemplate('darwin')).toEqual([{ role: 'appMenu' }, { role: 'editMenu' }])
  })
})
