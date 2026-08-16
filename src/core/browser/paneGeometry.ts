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
