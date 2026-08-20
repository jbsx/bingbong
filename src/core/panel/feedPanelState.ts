import type { PipelineEvent } from '../pipeline/events'

// Feed panel layout state (#45): overlay-vs-docked mode plus the auto-peek
// open state, as a pure fold over the pipeline event seam — the same shape
// as the run-progress tracker. Main owns one fold per window and broadcasts
// changes; the dashboard renders layout from it, the overlay renders chrome.

export type FeedPanelMode = 'overlay' | 'docked'

export interface FeedPanelState {
  mode: FeedPanelMode
  /** Peaked while a run is active; collapsed to the edge tab when idle. */
  open: boolean
}

/** Where the dashboard persists the mode — a view preference, not app settings. */
export const FEED_MODE_STORAGE_KEY = 'bingbong.feedMode'

export function isFeedPanelMode(value: unknown): value is FeedPanelMode {
  return value === 'overlay' || value === 'docked'
}

/**
 * Reads the persisted mode from localStorage-like storage. The default (and
 * the fallback for junk) is overlay: the feed floats above the browser pane
 * without taking layout space until the user docks it.
 */
export function readStoredFeedMode(storage: { getItem(key: string): string | null } | null | undefined): FeedPanelMode {
  const raw = storage?.getItem(FEED_MODE_STORAGE_KEY)
  return isFeedPanelMode(raw) ? raw : 'overlay'
}

/**
 * Folds pipeline events into the panel state: a command peaks the panel, the
 * run's done collapses it — busy rejections emit both, so the fold stays
 * balanced. Everything else (detail lines, statuses, out-of-turn
 * announcements) leaves the state untouched. `toggleOpen`/`setMode` are the
 * manual controls (header button, keyboard shortcut, dock toggle).
 */
export function createFeedPanelStateFold(): {
  onEvent(event: PipelineEvent): void
  setMode(mode: FeedPanelMode): void
  toggleOpen(): void
  state(): FeedPanelState
} {
  let state: FeedPanelState = { mode: 'overlay', open: false }

  return {
    onEvent(event) {
      switch (event.type) {
        case 'command':
          if (!state.open) state = { ...state, open: true }
          return
        case 'done':
          if (state.open) state = { ...state, open: false }
          return
        default:
          return
      }
    },
    setMode(mode) {
      if (mode !== state.mode) state = { ...state, mode }
    },
    toggleOpen() {
      state = { ...state, open: !state.open }
    },
    state: () => state,
  }
}
