import { useEffect, useState } from 'react'
import { HIDDEN_PANE_RECT, type PaneRect } from '../../core/browser/paneState'
import {
  FEED_MODE_STORAGE_KEY,
  FEED_WIDTH_STORAGE_KEY,
  defaultFeedPanelWidth,
  readStoredFeedMode,
  readStoredFeedWidth,
  type FeedPanelState,
} from '../../core/panel/feedPanelState'
import { reportRendererFault } from './diagnostics'

// The dashboard half of the feed panel (#45): the panel itself renders in
// its own overlay webContents; the dashboard owns the layout slot its rect
// is reported from, persists the mode (a view preference, not app
// settings), and mounts the header button / shortcut controls. The width
// rides the same preference flow (#65): stored width (or the mode's
// default — kiosk ships narrower) is pushed to the fold at mount, and
// every broadcast mirrors back to storage, whoever set it (drag, voice).

function storedWidth(): number {
  return readStoredFeedWidth(window.localStorage, defaultFeedPanelWidth())
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
      if (!cancelled && pulled) {
        setState(pulled)
      }
    })
    const unsubscribe = window.bingbong.feedPanel.onState((next) => {
      setState(next)
      // Open/close and mode changes are recorded (#187); the width is
      // not — a drag broadcasts per frame, and the record is about the
      // panel being there, not about a pointer.
      // Mirror every layout change back to storage, whoever made it
      // (header button, shortcut, drag handle, or a set_panel tool).
      try {
        window.localStorage.setItem(FEED_MODE_STORAGE_KEY, next.mode)
        window.localStorage.setItem(FEED_WIDTH_STORAGE_KEY, String(next.width))
      } catch (error) {
        // Private-browsing-style storage failures just lose persistence.
        reportRendererFault('feedPanel.persistLayout', error)
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
 * The returned callback ref tracks the slot element itself: the app boots
 * into the Idle Screen, so the slot mounts after this hook's first run, and
 * a slot that comes and goes with the Idle Screen must be reported each
 * time it reappears — or the overlay keeps a 0×0 view and the edge tab is
 * invisible (#331). ResizeObserver covers size changes; the window's own
 * resize covers the moves it cannot see — the collapsed tab and the Peek
 * Card keep their size and only move when the window (kiosk and
 * fullscreen switches included) changes size (#334); the keyed re-report
 * covers mode swaps, which move the slot without resizing it. Only a real
 * unmount (idle screen) hides the overlay — a key change must NEVER route the bounds through 0×0, or the
 * overlay page reflows against an empty viewport mid-transition and
 * synthesized (and real) clicks land on stale element positions.
 * `hidden` is the one deliberate exception: the slot holds a view that must
 * not show (anything of the panel's over the settings page, #329, #334),
 * so the overlay gets no bounds until it may show again.
 */
export function useFeedSlotRect(layoutKey: string, hidden = false): (el: HTMLDivElement | null) => void {
  const [el, setEl] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!el) {
      // The slot is gone (the Idle Screen took the window): so is the view.
      window.bingbong.feedPanel.reportRect(HIDDEN_PANE_RECT)
      return
    }
    const report = (): void => {
      if (hidden) {
        window.bingbong.feedPanel.reportRect(HIDDEN_PANE_RECT)
        return
      }
      const rect = el.getBoundingClientRect()
      const pane: PaneRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      window.bingbong.feedPanel.reportRect(pane)
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    window.addEventListener('resize', report)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
    }
    // `layoutKey` (mode/open) re-reports the position-only moves a
    // ResizeObserver cannot see.
  }, [el, layoutKey, hidden])

  // Unmount-only: the overlay view must not outlive its slot.
  useEffect(
    () => () => {
      window.bingbong.feedPanel.reportRect(HIDDEN_PANE_RECT)
    },
    [],
  )

  return setEl
}
