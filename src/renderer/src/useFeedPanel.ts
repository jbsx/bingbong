import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { HIDDEN_PANE_RECT, type PaneRect } from '../../core/browser/paneState'
import {
  FEED_MODE_STORAGE_KEY,
  readStoredFeedMode,
  type FeedPanelState,
} from '../../core/panel/feedPanelState'

// The dashboard half of the feed panel (#45): the panel itself renders in
// its own overlay webContents; the dashboard owns the layout slot its rect
// is reported from, persists the mode (a view preference, not app
// settings), and mounts the header button / shortcut controls.

const DEFAULT_PANEL_STATE: FeedPanelState = { mode: 'overlay', open: false }

export function useFeedPanel(): FeedPanelState {
  // First paint honors the persisted mode; main (the fold) confirms the
  // open state right after mount.
  const [state, setState] = useState<FeedPanelState>(() => ({
    ...DEFAULT_PANEL_STATE,
    mode: readStoredFeedMode(window.localStorage),
  }))

  useEffect(() => {
    // The stored mode is the dashboard's truth — push it to the fold so a
    // restart restores the layout the user chose.
    window.bingbong.feedPanel.setMode(readStoredFeedMode(window.localStorage))
    let cancelled = false
    void window.bingbong.feedPanel.getState().then((pulled) => {
      if (!cancelled && pulled) setState(pulled)
    })
    const unsubscribe = window.bingbong.feedPanel.onState((next) => {
      setState(next)
      // Mirror every mode change back to storage, whoever toggled it
      // (header button, shortcut, or the panel's own dock control).
      try {
        window.localStorage.setItem(FEED_MODE_STORAGE_KEY, next.mode)
      } catch {
        // Private-browsing-style storage failures just lose persistence.
      }
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return state
}

/**
 * Reports the slot element's rect to main, which sizes the overlay view.
 * ResizeObserver covers size changes (window, kiosk); the keyed re-report
 * covers position-only changes (mode swaps move the slot without resizing
 * it). Only a real unmount (idle screen, settings-only views) hides the
 * overlay — a key change must NEVER route the bounds through 0×0, or the
 * overlay page reflows against an empty viewport mid-transition and
 * synthesized (and real) clicks land on stale element positions.
 */
export function useFeedSlotRect(slotRef: RefObject<HTMLDivElement | null>, key: string): void {
  useEffect(() => {
    const el = slotRef.current
    if (!el) return
    const report = (): void => {
      const rect = el.getBoundingClientRect()
      const pane: PaneRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      window.bingbong.feedPanel.reportRect(pane)
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => {
      observer.disconnect()
    }
    // The slot element itself is stable; `key` (mode/open) re-reports the
    // position-only moves a ResizeObserver cannot see.
  }, [key])

  // Unmount-only: the overlay view must not outlive its slot.
  useEffect(
    () => () => {
      window.bingbong.feedPanel.reportRect(HIDDEN_PANE_RECT)
    },
    [],
  )
}
