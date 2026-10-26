import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { onWindowClosed } from './onWindowClosed'

describe('onWindowClosed (#450)', () => {
  it('holds one closed listener however many surfaces attach, and runs each disposal once, in order', () => {
    const win = new EventEmitter()
    const ran: number[] = []

    for (let index = 0; index < 25; index += 1) onWindowClosed(win as unknown as Electron.BrowserWindow, () => ran.push(index))

    expect(win.listenerCount('closed')).toBe(1)
    win.emit('closed')
    win.emit('closed')
    expect(ran).toEqual(Array.from({ length: 25 }, (_, index) => index))
    expect(win.listenerCount('closed')).toBe(0)
  })

  it('keeps each window to its own disposals', () => {
    const first = new EventEmitter()
    const second = new EventEmitter()
    const ran: string[] = []
    onWindowClosed(first as unknown as Electron.BrowserWindow, () => ran.push('first'))
    onWindowClosed(second as unknown as Electron.BrowserWindow, () => ran.push('second'))

    second.emit('closed')
    expect(ran).toEqual(['second'])
    expect(first.listenerCount('closed')).toBe(1)
  })
})
