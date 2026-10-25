import { describe, expect, it } from 'vitest'
import { resolveLaunchConfig } from './launchConfig'
import { windowFrame } from './windowFrame'

// The dashboard window's frame (#426, why in windowFrame.ts): windowed hides
// GTK's resize border with a transparent window; the kiosk is fullscreen,
// has no border, and is opaque on the theme's ground.

describe('windowFrame', () => {
  it('makes the kiosk window fullscreen and opaque on the ground', () => {
    expect(windowFrame(resolveLaunchConfig(['--kiosk'], {}), '#0b0d11')).toEqual({
      transparent: false,
      backgroundColor: '#0b0d11',
      fullscreen: true,
      autoHideMenuBar: true,
    })
  })

  it('keeps the windowed window transparent, and not fullscreen', () => {
    expect(windowFrame(resolveLaunchConfig([], {}), '#0b0d11')).toEqual({ transparent: true })
  })
})
