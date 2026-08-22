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
  /** Panel width in px (#65) — one folded value both renderers apply. */
  width: number
}

/** Where the dashboard persists the mode — a view preference, not app settings. */
export const FEED_MODE_STORAGE_KEY = 'bingbong.feedMode'

/** Where the dashboard persists the width — same view-preference deal. */
export const FEED_WIDTH_STORAGE_KEY = 'bingbong.feedWidth'

/** The doubled default (#65): typical answers readable at a glance. */
export const FEED_PANEL_WIDTH_DEFAULT = 880
/** Kiosk default — the appliance's pane keeps more of the window. */
export const FEED_PANEL_WIDTH_KIOSK = 800
/** No narrower than this, whatever the window says. */
export const FEED_PANEL_WIDTH_MIN = 320
/** No wider than this fraction of the window's content width. */
export const FEED_PANEL_WIDTH_MAX_FRACTION = 0.75

/** The boot-time width per launch mode (#65) — kiosk ships narrower. */
export function defaultFeedPanelWidth(kiosk: boolean): number {
  return kiosk ? FEED_PANEL_WIDTH_KIOSK : FEED_PANEL_WIDTH_DEFAULT
}

/** The one junk-width guard: a finite, positive pixel count. */
export function isUsableFeedPanelWidth(width: unknown): width is number {
  return typeof width === 'number' && Number.isFinite(width) && width > 0
}

/**
 * The one width policy every surface applies (#65): CSS clamp() semantics —
 * max(MIN, min(VAL, MAX)) — so the 320px floor holds even on a window too
 * small for both bounds. Main clamps against the live window before the
 * fold; the dashboard's CSS re-clamps so a shrinking window bounds the
 * slot without discarding the persisted width.
 */
export function clampFeedPanelWidth(width: number, windowWidth: number): number {
  const max = Math.floor(windowWidth * FEED_PANEL_WIDTH_MAX_FRACTION)
  return Math.max(FEED_PANEL_WIDTH_MIN, Math.min(Math.round(width), max))
}

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
 * Reads the persisted width; the caller supplies the fallback because only
 * it knows kiosk. Raw value returned: boot reconciliation clamps against
 * the live window in the fold, and the clamped value is what persists —
 * the preference always holds the last applied width, never one the
 * current window can no longer honor.
 */
export function readStoredFeedWidth(
  storage: { getItem(key: string): string | null } | null | undefined,
  fallback: number,
): number {
  const raw = storage?.getItem(FEED_WIDTH_STORAGE_KEY)
  const parsed = typeof raw === 'string' ? Number(raw) : Number.NaN
  return isUsableFeedPanelWidth(parsed) ? parsed : fallback
}

/**
 * Folds pipeline events into the panel state: a command peaks the panel, the
 * run's done collapses it — busy rejections emit both, so the fold stays
 * balanced. Everything else (detail lines, statuses, out-of-turn
 * announcements) leaves the state untouched. `toggleOpen`/`setMode` are the
 * manual controls (header button, keyboard shortcut, dock toggle).
 */
export function createFeedPanelStateFold(options?: { defaultWidth?: number }): {
  onEvent(event: PipelineEvent): void
  setMode(mode: FeedPanelMode): void
  setWidth(width: number): void
  toggleOpen(): void
  state(): FeedPanelState
} {
  let state: FeedPanelState = {
    mode: 'overlay',
    open: false,
    width: options?.defaultWidth ?? FEED_PANEL_WIDTH_DEFAULT,
  }

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
    setWidth(width) {
      // Callers clamp against the live window; the fold just refuses junk
      // so a malformed payload can never corrupt the broadcast state.
      if (isUsableFeedPanelWidth(width)) state = { ...state, width: Math.round(width) }
    },
    toggleOpen() {
      state = { ...state, open: !state.open }
    },
    state: () => state,
  }
}
