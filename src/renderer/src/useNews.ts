import { useEffect, useState } from 'react'
import type { TodaysHighlight } from '../../core/news/newsDesk'

export type NewsState =
  | { status: 'loading' }
  | { status: 'unset' }
  | { status: 'none' }
  | { status: 'ready'; highlight: TodaysHighlight }

/** How often the highlight is asked for again while the Idle Screen shows; main fetches the sources at most hourly whatever this is. */
const REFRESH_MS = 5 * 60 * 1000

/**
 * The News card's Today's Highlight (CONTEXT.md), asked of main when the
 * Idle Screen shows and every few minutes after. An empty Interest Profile
 * reads as unset; a desk that has never had a story as none. Main keeps the
 * last highlight through a failed poll, so a later ask never blanks it.
 */
export function useNews(topicCount: number, active: boolean): NewsState {
  const [state, setState] = useState<NewsState>({ status: 'loading' })

  useEffect(() => {
    if (!active) return
    if (topicCount === 0) {
      setState({ status: 'unset' })
      return
    }
    let cancelled = false
    const ask = (): void => {
      void window.bingbong.news.highlight().then((highlight) => {
        if (!cancelled) setState(highlight === null ? { status: 'none' } : { status: 'ready', highlight })
      })
    }
    ask()
    const refresh = setInterval(ask, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(refresh)
    }
  }, [topicCount, active])

  return state
}
