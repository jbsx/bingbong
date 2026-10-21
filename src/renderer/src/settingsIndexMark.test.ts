import { describe, expect, it } from 'vitest'
import { markedSection, SECTION_REACH_PX } from './settingsIndexMark'

// The Settings index's mark while the page is scrolled by hand: the section
// whose heading has reached the top, the last one once the scroll is at its end.

const PLACE = { scrollTop: 400, clientHeight: 600, scrollHeight: 3000 }

describe('markedSection', () => {
  it('marks the first section before any has reached the top', () => {
    expect(markedSection([{ id: 'voice', top: 8 }, { id: 'appearance', top: 300 }], { ...PLACE, scrollTop: 0 })).toBe('voice')
  })

  it('marks the last section whose heading has come within reach of the top', () => {
    const tops = [
      { id: 'voice', top: -900 },
      { id: 'appearance', top: -200 },
      { id: 'browsing', top: 8 },
      { id: 'weather', top: 120 },
    ]
    expect(markedSection(tops, PLACE)).toBe('browsing')
  })

  it('counts a heading exactly at the reach, and not one a pixel past it', () => {
    expect(markedSection([{ id: 'a', top: -50 }, { id: 'b', top: SECTION_REACH_PX }], PLACE)).toBe('b')
    expect(markedSection([{ id: 'a', top: -50 }, { id: 'b', top: SECTION_REACH_PX + 1 }], PLACE)).toBe('a')
  })

  it('marks the last section once the scroll is at its end, though its heading never reached the top', () => {
    const tops = [
      { id: 'weather', top: -400 },
      { id: 'weight', top: 8 },
      { id: 'ai usage', top: 320 },
    ]
    expect(markedSection(tops, { scrollTop: 2400, clientHeight: 600, scrollHeight: 3000 })).toBe('ai usage')
    // A zoomed page stops a fraction short of its exact end.
    expect(markedSection(tops, { scrollTop: 2398.6, clientHeight: 600, scrollHeight: 3000 })).toBe('ai usage')
  })

  it('does not take a page too short to scroll as at its end', () => {
    expect(markedSection([{ id: 'voice', top: 8 }, { id: 'weight', top: 200 }], { scrollTop: 0, clientHeight: 600, scrollHeight: 600 })).toBe('voice')
  })

  it('marks nothing when no section is on the page', () => {
    expect(markedSection([], PLACE)).toBeUndefined()
  })
})
