import { useEffect, useState } from 'react'
import type { TopRepo } from '../../core/news/topRepos'
import { reportRendererFault } from './diagnostics'

export type NewsCardState = { status: 'loading' } | { status: 'none' } | { status: 'ready'; repos: TopRepo[] }

/** How often the card's repositories are asked for again while the Idle Screen shows; main reads GitHub at most hourly whatever this is. */
const REFRESH_MS = 5 * 60 * 1000

/**
 * The News card's Top Repos (CONTEXT.md), asked of main when the Idle
 * Screen shows and every few minutes after. A GitHub never read reads as
 * none; main keeps the last list through a failed read, so a later ask
 * never blanks it.
 */
export function useNews(active: boolean): NewsCardState {
  const [state, setState] = useState<NewsCardState>({ status: 'loading' })

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const ask = (): void => {
      window.bingbong.news.repos().then(
        (repos) => {
          if (!cancelled) setState(repos === null ? { status: 'none' } : { status: 'ready', repos })
        },
        (error: unknown) => {
          // The card keeps what it shows; a desk never reached reads as none yet.
          reportRendererFault('news.repos', error)
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
  }, [active])

  return state
}
