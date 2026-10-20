import { HIDDEN_PANE_RECT, type PaneRect } from './paneState'

export type PaneBounds = PaneRect

export function toPaneBounds(rect: PaneRect): PaneBounds {
  const width = Math.round(rect.width)
  const height = Math.round(rect.height)
  if (width <= 0 || height <= 0) return HIDDEN_PANE_RECT
  return {
    x: Math.max(0, Math.round(rect.x)),
    y: Math.max(0, Math.round(rect.y)),
    width,
    height,
  }
}

/**
 * Where a hidden pane goes (ADR 0079): off the window but for a pixel
 * column at its right edge, at the size it was last shown — the window's,
 * when it never was — so a Command typed over the Idle Screen reads the
 * page as it lays out, not a 0×0 view whose every element is out of
 * sight. The column is what keeps it sized: a view wholly outside the
 * window is laid out at 0×0, as a parked one is (`parkedDesktopPaneRect`).
 */
export function hiddenPaneBounds(shown: PaneBounds | null, window: { width: number; height: number }): PaneBounds {
  const width = Math.round(window.width)
  return { x: Math.max(0, width - 1), y: 0, width: shown?.width ?? width, height: shown?.height ?? Math.round(window.height) }
}
