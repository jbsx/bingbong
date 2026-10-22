import { useEffect, useState } from 'react'
import { USAGE_HISTORY_MS, type UsageSnapshot } from '../../core/usage/usage'
import { keepAnswer, keptAnswer } from './idleCache'

export type UsageState =
  | { status: 'unset' }
  | { status: 'loading' }
  | { status: 'ready'; snapshot: UsageSnapshot }
  | { status: 'error'; message: string }

/** The dashboard samples once a minute; polling faster shows nothing new. */
const REFRESH_MS = 60 * 1000

/** The state to show before the poll answers: the last snapshot from this dashboard within its chart's span, else loading. The card says how old it is. */
function keptUsage(target: string): UsageState {
  if (target === '') return { status: 'unset' }
  const snapshot = keptAnswer<UsageSnapshot>('usage', target, USAGE_HISTORY_MS)
  return snapshot === null ? { status: 'loading' } : { status: 'ready', snapshot }
}

/**
 * The AI usage dashboard's snapshot for the Idle Screen, fetched through
 * main. Only polls while `active` (the Idle Screen is the one consumer), and
 * refetches when the URL changes. The last snapshot (idleCache) shows at
 * once while the poll is out. A failed poll after a good one keeps the
 * last snapshot on screen — the dashboard's own numbers move slowly — so
 * only a dashboard never reached reads as an error.
 */
export function useUsage(url: string | null, active: boolean): UsageState {
  const target = url?.trim() ?? ''
  const [state, setState] = useState<UsageState>(() => keptUsage(target))

  useEffect(() => {
    if (!active) return
    setState(keptUsage(target))
    if (target === '') return
    let cancelled = false
    const load = () => {
      window.bingbong.usage.get().then(
        (snapshot) => {
          if (snapshot !== null) keepAnswer('usage', target, snapshot)
          if (!cancelled) setState(snapshot === null ? { status: 'unset' } : { status: 'ready', snapshot })
        },
        (err: unknown) => {
          if (cancelled) return
          const message = err instanceof Error ? err.message : String(err)
          setState((prev) => (prev.status === 'ready' ? prev : { status: 'error', message }))
        },
      )
    }
    load()
    const interval = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [target, active])

  return state
}
