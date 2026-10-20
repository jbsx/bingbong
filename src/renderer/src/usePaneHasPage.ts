import { useEffect, useState } from 'react'
import { isRealPage } from '../../core/browser/lastPage'

/** Whether the pane has a page to show, or one on its way (#361): with none, the Idle Screen is all there is to wake to. */
export function usePaneHasPage(): boolean {
  const [hasPage, setHasPage] = useState(false)
  useEffect(() => {
    let cancelled = false
    const follow = (state: { url: string; pendingUrl: string }): void => {
      if (!cancelled) setHasPage(isRealPage(state.url) || isRealPage(state.pendingUrl))
    }
    void window.bingbong.browser.getState().then(follow)
    const unsubscribe = window.bingbong.browser.onState(follow)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
  return hasPage
}
