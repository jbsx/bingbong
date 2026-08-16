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
