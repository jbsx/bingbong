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

/** One voice step (#71): the fixed quantum "wider"/"narrower" moves by. */
export const FEED_PANEL_WIDTH_STEP = 160
/** The most steps one set_panel_width call may move (#71). */
export const FEED_PANEL_WIDTH_MAX_STEPS = 5

/** The relative-step directions the voice width tool accepts (#71). */
export type PanelWidthDirection = 'wider' | 'narrower'
/** The named width presets the voice width tool accepts (#71). */
export type PanelWidthPreset = 'half_screen'

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

export function isPanelWidthDirection(value: unknown): value is PanelWidthDirection {
  return value === 'wider' || value === 'narrower'
}

export function isPanelWidthPreset(value: unknown): value is PanelWidthPreset {
  return value === 'half_screen'
}

/**
 * The relative-step target (#71): current ± step×count, clamped to the same
 * bounds every width writer applies. A fractional or non-positive count
 * degrades to one step — the direction is the user's intent, the count is
 * emphasis, and neither may ever move the panel backwards or freeze it.
 */
export function stepFeedPanelWidth(
  current: number,
  direction: PanelWidthDirection,
  steps: number,
  windowWidth: number,
): number {
  const count = Number.isFinite(steps) ? Math.max(1, Math.round(steps)) : 1
  const delta = FEED_PANEL_WIDTH_STEP * count * (direction === 'wider' ? 1 : -1)
  return clampFeedPanelWidth(current + delta, windowWidth)
}

/** Each preset's fraction of the window's content width — exhaustively one row per preset. */
const PANEL_WIDTH_PRESET_FRACTIONS: Record<PanelWidthPreset, number> = {
  half_screen: 0.5,
}

/**
 * The preset target (#71): a named fraction of the window's content width,
 * clamped to the same bounds — "half screen" on a 400px window is still the
 * 320px floor, because the floor is the hard promise.
 */
export function presetFeedPanelWidth(preset: PanelWidthPreset, windowWidth: number): number {
  return clampFeedPanelWidth(windowWidth * PANEL_WIDTH_PRESET_FRACTIONS[preset], windowWidth)
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
 * run's done collapses it. Busy rejections bypass this Run fold entirely.
 * Everything else (detail lines, statuses, out-of-turn
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
        case 'session_ended':
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
