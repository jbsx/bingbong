import { useEffect, useState } from 'react'
import type { NewsDigest } from '../../core/news/newsDesk'
import { reportRendererFault } from './diagnostics'

export type NewsCardState =
  | { status: 'loading' }
  | { status: 'unset' }
  | { status: 'none' }
  | { status: 'ready'; digest: NewsDigest }

/** How often the card's stories are asked for again while the Idle Screen shows; main fetches the sources at most hourly whatever this is. */
const REFRESH_MS = 5 * 60 * 1000

/**
 * The News card's Today's Highlight, This Week and This Month (CONTEXT.md),
 * asked of main when the Idle Screen shows and every few minutes after. An empty Interest Profile
 * reads as unset; a desk that has never had a story as none. Main keeps the
 * last highlight through a failed poll, so a later ask never blanks it.
 */
export function useNews(topicCount: number, active: boolean): NewsCardState {
  const [state, setState] = useState<NewsCardState>({ status: 'loading' })

  useEffect(() => {
    if (!active) return
    if (topicCount === 0) {
      setState({ status: 'unset' })
      return
    }
    let cancelled = false
    const ask = (): void => {
      window.bingbong.news.digest().then(
        (digest) => {
          if (!cancelled) setState(digest === null ? { status: 'none' } : { status: 'ready', digest })
        },
        (error: unknown) => {
          // The card keeps what it shows; a desk never reached reads as no news yet.
          reportRendererFault('news.digest', error)
          if (!cancelled) setState((prev) => (prev.status === 'loading' ? { status: 'none' } : prev))
        },
      )
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
