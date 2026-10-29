import { describe, expect, it } from 'vitest'
import { LINE_OVERLAY_MS, lineAfter, lineOverlaySurface, lineShownFor } from './lineOverlay'

// The Line Overlay (#513): the line the app would have said, big, on
// whatever surface is up, for 15 s or until the next line.

describe('the Line Overlay', () => {
  it('takes a line from its event and keeps it past every other event', () => {
    const line = lineAfter(null, { type: 'line', text: 'Opened the BBC.', at: 1000 })
    expect(line).toEqual({ text: 'Opened the BBC.', failure: false, at: 1000 })
    expect(lineAfter(line, { type: 'status', at: 2000 })).toBe(line)
  })

  it('the next line takes its place, a failure marked so', () => {
    const first = lineAfter(null, { type: 'line', text: 'Opened the BBC.', at: 1000 })
    expect(lineAfter(first, { type: 'line', text: 'Nothing heard.', failure: true, at: 3000 })).toEqual({ text: 'Nothing heard.', failure: true, at: 3000 })
  })

  it('stays up 15 seconds from the line, then is gone', () => {
    expect(LINE_OVERLAY_MS).toBe(15_000)
    const line = { text: 'Timer set.', failure: false, at: 10_000 }
    expect(lineShownFor(line, 10_000)).toBe(15_000)
    expect(lineShownFor(line, 24_000)).toBe(1_000)
    expect(lineShownFor(line, 25_000)).toBe(0)
    expect(lineShownFor(null, 0)).toBe(0)
  })

  it('shows on the pane, the Idle Screen or over Settings, as the Wait Card does', () => {
    expect(lineOverlaySurface(false, false, 'dashboard')).toBe('none')
    expect(lineOverlaySurface(true, true, 'dashboard')).toBe('idle')
    expect(lineOverlaySurface(true, false, 'dashboard')).toBe('pane')
    expect(lineOverlaySurface(true, false, 'settings')).toBe('dashboard')
  })
})
