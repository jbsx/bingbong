import { useEffect, useState } from 'react'
import type { UsageSnapshot } from '../../core/usage/usage'

export type UsageState =
  | { status: 'unset' }
  | { status: 'loading' }
  | { status: 'ready'; snapshot: UsageSnapshot }
  | { status: 'error'; message: string }

/** The dashboard samples once a minute; polling faster shows nothing new. */
const REFRESH_MS = 60 * 1000

/**
 * The AI usage dashboard's snapshot for the Idle Screen, fetched through
 * main. Only polls while `active` (the Idle Screen is the one consumer), and
 * refetches when the URL changes. A failed poll after a good one keeps the
 * last snapshot on screen — the dashboard's own numbers move slowly — so
 * only a dashboard never reached reads as an error.
 */
export function useUsage(url: string | null, active: boolean): UsageState {
  const [state, setState] = useState<UsageState>({ status: 'loading' })
  const target = url?.trim() ?? ''

  useEffect(() => {
    if (!active) return
    if (target === '') {
      setState({ status: 'unset' })
      return
    }
    let cancelled = false
    const load = () => {
      window.bingbong.usage.get().then(
        (snapshot) => {
          if (!cancelled) setState(snapshot === null ? { status: 'unset' } : { status: 'ready', snapshot })
        },
        (err: unknown) => {
          if (cancelled) return
          const message = err instanceof Error ? err.message : String(err)
          setState((prev) => (prev.status === 'ready' ? prev : { status: 'error', message }))
        },
      )
    }
    setState({ status: 'loading' })
    load()
    const interval = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [target, active])

  return state
}
