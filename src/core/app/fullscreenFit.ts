// Fullscreen is pixel-identical to windowed (ADR 0012, #331). A fullscreen
// frameless window on Linux can keep its client frame insets and come up
// wider than the display (measured under Xvfb: x -4, 1288×804 on a
// 1280×800 screen), which pushes the Toolbar's edges off-screen. The fit
// answers the bounds that pull it back, or null when the window already
// lies within the display — X11 without a window manager rounds a
// screen-sized window one pixel short, and correcting that would only loop.

export interface WindowRect {
  x: number
  y: number
  width: number
  height: number
}

export function fullscreenFit(content: WindowRect, display: WindowRect): WindowRect | null {
  const spills =
    content.x < display.x ||
    content.y < display.y ||
    content.x + content.width > display.x + display.width ||
    content.y + content.height > display.y + display.height
  return spills ? { ...display } : null
}
