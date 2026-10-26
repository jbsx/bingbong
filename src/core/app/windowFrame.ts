import type { LaunchConfig } from './launchConfig'

// The dashboard window's frame, the part of its options the launch decides
// (#426). On Linux Electron frames a title-bar-less window with its own 4 px
// resize border on three sides (_GTK_FRAME_EXTENTS 4,4,0,4), painted in
// GTK's light ground — a white border around the dark shell. Only a
// translucent window drops it (hasShadow does not); the dashboard paints its
// own ground, so nothing shows through.
//
// Kiosk = fullscreen appliance (ADR 0012), which has no border to hide, so
// it is opaque. Opaque takes more than `transparent: false`: a frameless
// window on Linux (titleBarStyle 'hidden') draws its own client-side frame
// shadow, and whenever a compositing manager runs (picom on the kiosk)
// Electron gives it a 32-bit ARGB visual anyway, so the compositor blends
// the whole screen with alpha. Measured under Xvfb + picom (#426): frameless
// and `transparent: false` is Depth 32; framed is Depth 24, with or without
// the compositor; `hasShadow: false` and --disable-transparent-visuals stay
// 32. So the kiosk keeps the OS frame, which fullscreen hides. An opaque
// window shows its backgroundColor (white by default) until the renderer's
// first paint, so the kiosk takes the theme's ground for it.
//
// Windowed: no OS title bar or window buttons, the renderer's Toolbar band
// is the drag region and Alt+F4 closes (ADR 0012).

export interface WindowFrame {
  transparent: boolean
  titleBarStyle?: 'hidden'
  backgroundColor?: string
  fullscreen?: boolean
  autoHideMenuBar?: boolean
}

export function windowFrame(config: Pick<LaunchConfig, 'kiosk'>, ground: string): WindowFrame {
  return config.kiosk
    ? { transparent: false, backgroundColor: ground, fullscreen: true, autoHideMenuBar: true }
    : { transparent: true, titleBarStyle: 'hidden' }
}
