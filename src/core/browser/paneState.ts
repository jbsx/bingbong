export interface BrowserPaneState {
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}

export interface PaneRect {
  x: number
  y: number
  width: number
  height: number
}

export const HIDDEN_PANE_RECT: PaneRect = { x: 0, y: 0, width: 0, height: 0 }

/** The desktop viewport live subagent pages lay out at (#57). */
export const DESKTOP_PANE_SIZE = { width: 1280, height: 800 } as const

/**
 * Where live subagent views are parked while their agent runs (#57): laid
 * out at the full DESKTOP_PANE_SIZE but rotated edge-on to the window — a
 * sliver of overlap keeps Chromium painting the view (fully offscreen
 * views capture blank; fully occluded ones never produce their first
 * frame). Later views stack above earlier ones, so each earlier view parks
 * further left: every parked view keeps its own unoccluded pixel column.
 * The sliver sits at the window's right edge — a device pixel wide and
 * effectively invisible.
 */
export function parkedDesktopPaneRect(contentWidth: number, laterParkedViews = 0): PaneRect {
  return {
    x: Math.max(0, Math.round(contentWidth) - 1 - laterParkedViews * 4),
    y: 0,
    width: DESKTOP_PANE_SIZE.width,
    height: DESKTOP_PANE_SIZE.height,
  }
}

export function samePaneRect(a: PaneRect, b: PaneRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

export function idleBrowserPaneState(): BrowserPaneState {
  return { url: '', title: '', canGoBack: false, canGoForward: false, loading: false }
}

export function isPaneRect(value: unknown): value is PaneRect {
  if (typeof value !== 'object' || value === null) return false
  const rect = value as Record<string, unknown>
  return (
    Object.keys(rect).length === 4 &&
    ['x', 'y', 'width', 'height'].every((key) => typeof rect[key] === 'number' && Number.isFinite(rect[key]))
  )
}
