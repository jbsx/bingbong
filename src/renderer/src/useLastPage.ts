import { useEffect, useState } from 'react'
import type { LastPage } from '../../core/browser/lastPage'

/**
 * The Last Page (CONTEXT.md) for the Idle Screen: pulled on mount, since
 * the page may predate the renderer (a restart), and followed as the pane
 * moves. Only read while `active` — the Idle Screen is the one consumer.
 */
export function useLastPage(active: boolean): LastPage | null {
  const [page, setPage] = useState<LastPage | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    void window.bingbong.browser.getLastPage().then((current) => {
      if (!cancelled) setPage(current)
    })
    const unsubscribe = window.bingbong.browser.onLastPage(setPage)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [active])

  return page
}
