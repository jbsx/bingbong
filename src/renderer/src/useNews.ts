import { useEffect, useState } from 'react'
import type { TopRepo } from '../../core/news/topRepos'
import { reportRendererFault } from './diagnostics'
import { keepAnswer, keptAnswer } from './idleCache'

export type NewsCardState = { status: 'loading' } | { status: 'none' } | { status: 'ready'; repos: TopRepo[] }

/** How often the card's repositories are asked for again while the Idle Screen shows; main reads GitHub at most hourly whatever this is. */
const REFRESH_MS = 5 * 60 * 1000

/** How old a kept list may be and still show: the repos are the day's. */
const KEPT_MAX_AGE_MS = 24 * 60 * 60 * 1000

function keptNews(): NewsCardState {
  const repos = keptAnswer<TopRepo[]>('news', '', KEPT_MAX_AGE_MS)
  return repos === null ? { status: 'loading' } : { status: 'ready', repos }
}

/**
 * The News card's Top Repos (CONTEXT.md), asked of main when the Idle
 * Screen shows and every few minutes after. The last list (idleCache)
 * shows at once while the ask is out, and stands through a main that has
 * not read GitHub yet (a restart). A GitHub never read reads as none; main
 * keeps the last list through a failed read, so a later ask never blanks it.
 */
export function useNews(active: boolean): NewsCardState {
  const [state, setState] = useState<NewsCardState>(keptNews)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const ask = (): void => {
      window.bingbong.news.repos().then(
        (repos) => {
          if (repos !== null) keepAnswer('news', '', repos)
          if (!cancelled) setState((prev) => (repos !== null ? { status: 'ready', repos } : prev.status === 'ready' ? prev : { status: 'none' }))
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
