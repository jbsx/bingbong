import type { PaneRect } from './paneState'

export interface PaneBounds {
  x: number
  y: number
  width: number
  height: number
}

const HIDDEN_BOUNDS: PaneBounds = { x: 0, y: 0, width: 0, height: 0 }

export function toPaneBounds(rect: PaneRect): PaneBounds {
  const width = Math.round(rect.width)
  const height = Math.round(rect.height)
  if (width <= 0 || height <= 0) return HIDDEN_BOUNDS
  return {
    x: Math.max(0, Math.round(rect.x)),
    y: Math.max(0, Math.round(rect.y)),
    width,
    height,
  }
}
