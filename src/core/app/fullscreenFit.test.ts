import { describe, expect, it } from 'vitest'
import { fullscreenFit } from './fullscreenFit'

// The fullscreen fit (#331, why in fullscreenFit.ts): a window that spills
// past its display is pulled back onto it; one within it is left alone.

const display = { x: 0, y: 0, width: 1280, height: 800 }

describe('fullscreenFit', () => {
  it('pulls a window that spills past the display back onto it', () => {
    expect(fullscreenFit({ x: -4, y: 0, width: 1288, height: 804 }, display)).toEqual(display)
  })

  it('leaves a window that lies within the display alone', () => {
    expect(fullscreenFit(display, display)).toBeNull()
    // X11 without a window manager rounds a screen-sized window one pixel
    // short; correcting that again would only loop.
    expect(fullscreenFit({ x: 0, y: 0, width: 1279, height: 799 }, display)).toBeNull()
  })

  it('measures against a display that is not at the origin', () => {
    const second = { x: 1280, y: 0, width: 1920, height: 1080 }
    expect(fullscreenFit({ x: 1276, y: 0, width: 1928, height: 1084 }, second)).toEqual(second)
    expect(fullscreenFit(second, second)).toBeNull()
  })
})
