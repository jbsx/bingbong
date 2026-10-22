import { useEffect, useState } from 'react'
import type { LastPage } from '../../core/browser/lastPage'
import { keepAnswer, keptAnswer } from './idleCache'

/**
 * The Last Page (CONTEXT.md) for the Idle Screen: the last one known
 * (idleCache) from the first frame, then pulled on mount, since the page
 * may predate the renderer (a restart), and followed as the pane moves.
 * Only read while `active` — the Idle Screen is the one consumer.
 */
export function useLastPage(active: boolean): LastPage | null {
  const [page, setPage] = useState<LastPage | null>(() => keptAnswer<LastPage>('lastPage', '', Infinity))

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const follow = (current: LastPage | null): void => {
      keepAnswer('lastPage', '', current)
      setPage(current)
    }
    void window.bingbong.browser.getLastPage().then((current) => {
      if (!cancelled) follow(current)
    })
    const unsubscribe = window.bingbong.browser.onLastPage(follow)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [active])

  return page
}
