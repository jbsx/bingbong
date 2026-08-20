import type { PaneRect } from '../browser/paneState'
import type { FeedPanelMode, FeedPanelState } from './feedPanelState'

// Feed panel IPC (#45): the dashboard reports the panel slot's rect (the
// native overlay view's bounds, exactly like the browser pane's viewport
// rect), either renderer can switch mode or toggle the panel, and main
// broadcasts the folded state to both. One channel pair, both directions.

export const PANEL_IPC = {
  /** Dashboard → main: the panel slot's current rect (0×0 hides the view). */
  rect: 'feed-panel:rect',
  /** Either renderer → main: switch overlay/docked layout mode. */
  setMode: 'feed-panel:set-mode',
  /** Either renderer → main: flip the peaked/collapsed state. */
  toggle: 'feed-panel:toggle',
  /** Main → both renderers: the folded { mode, open } state. */
  state: 'feed-panel:state',
  /** Either renderer → main: the current folded state (boot-time pull). */
  get: 'feed-panel:get',
} as const

export interface FeedPanelSetModePayload {
  mode: FeedPanelMode
}

export interface FeedPanelRectPayload {
  rect: PaneRect
}

export type FeedPanelStatePayload = FeedPanelState

export function isFeedPanelStatePayload(value: unknown): value is FeedPanelStatePayload {
  if (typeof value !== 'object' || value === null) return false
  const state = value as Record<string, unknown>
  return (state.mode === 'overlay' || state.mode === 'docked') && typeof state.open === 'boolean'
}
