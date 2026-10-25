import type { LaunchConfig } from './launchConfig'

// The dashboard window's frame, the part of its options the launch decides
// (#426). On Linux Electron frames a title-bar-less window with its own 4 px
// resize border on three sides (_GTK_FRAME_EXTENTS 4,4,0,4), painted in
// GTK's light ground — a white border around the dark shell. Only a
// translucent window drops it (hasShadow does not); the dashboard paints its
// own ground, so nothing shows through.
//
// Kiosk = fullscreen appliance (ADR 0012), which has no border to hide, so
// it is opaque: on X11 with no compositor a transparent window takes an ARGB
// visual and Chromium blends the whole screen with alpha every frame. An
// opaque window shows its backgroundColor (white by default) until the
// renderer's first paint, so the kiosk takes the theme's ground for it.

export interface WindowFrame {
  transparent: boolean
  backgroundColor?: string
  fullscreen?: boolean
  autoHideMenuBar?: boolean
}

export function windowFrame(config: Pick<LaunchConfig, 'kiosk'>, ground: string): WindowFrame {
  return config.kiosk
    ? { transparent: false, backgroundColor: ground, fullscreen: true, autoHideMenuBar: true }
    : { transparent: true }
}
