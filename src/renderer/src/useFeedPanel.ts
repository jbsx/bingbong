import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { HIDDEN_PANE_RECT, type PaneRect } from '../../core/browser/paneState'
import {
  FEED_MODE_STORAGE_KEY,
  FEED_WIDTH_STORAGE_KEY,
  defaultFeedPanelWidth,
  readStoredFeedMode,
  readStoredFeedWidth,
  type FeedPanelState,
} from '../../core/panel/feedPanelState'

// The dashboard half of the feed panel (#45): the panel itself renders in
// its own overlay webContents; the dashboard owns the layout slot its rect
// is reported from, persists the mode (a view preference, not app
// settings), and mounts the header button / shortcut controls. The width
// rides the same preference flow (#65): stored width (or the mode's
// default — kiosk ships narrower) is pushed to the fold at mount, and
// every broadcast mirrors back to storage, whoever set it (drag, voice).

function storedWidth(): number {
  return readStoredFeedWidth(window.localStorage, defaultFeedPanelWidth(window.bingbong.app.kiosk))
}

export function useFeedPanel(): FeedPanelState {
  // First paint honors the persisted layout; main (the fold) confirms the
  // open state right after mount.
  const [state, setState] = useState<FeedPanelState>(() => ({
    mode: readStoredFeedMode(window.localStorage),
    open: false,
    width: storedWidth(),
  }))

  useEffect(() => {
    // The stored layout is the dashboard's truth — push it to the fold so a
    // restart restores the layout the user chose. Main clamps the width
    // against the live window before folding; the broadcast reconciles us.
    window.bingbong.feedPanel.setMode(readStoredFeedMode(window.localStorage))
    window.bingbong.feedPanel.setWidth(storedWidth())
    let cancelled = false
    void window.bingbong.feedPanel.getState().then((pulled) => {
      if (!cancelled && pulled) setState(pulled)
    })
    const unsubscribe = window.bingbong.feedPanel.onState((next) => {
      setState(next)
      // Mirror every layout change back to storage, whoever made it
      // (header button, shortcut, drag handle, or a set_panel tool).
      try {
        window.localStorage.setItem(FEED_MODE_STORAGE_KEY, next.mode)
        window.localStorage.setItem(FEED_WIDTH_STORAGE_KEY, String(next.width))
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
export function useFeedSlotRect(slotRef: RefObject<HTMLDivElement | null>, layoutKey: string): void {
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
    // The slot element itself is stable; `layoutKey` (mode/open) re-reports
    // the position-only moves a ResizeObserver cannot see.
  }, [layoutKey])

  // Unmount-only: the overlay view must not outlive its slot.
  useEffect(
    () => () => {
      window.bingbong.feedPanel.reportRect(HIDDEN_PANE_RECT)
    },
    [],
  )
}
