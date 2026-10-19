import { useEffect, useState } from 'react'
import type { TimerState } from '../../core/timer/timer'

/**
 * The Timer (CONTEXT.md) for the Idle Screen: pulled on mount, since it may
 * have been set while the dashboard showed, and followed as it runs out,
 * rings and is dismissed. Only read while `active` — the Idle Screen is the
 * one consumer.
 */
export function useTimer(active: boolean): TimerState {
  const [state, setState] = useState<TimerState>({ status: 'off' })

  useEffect(() => {
    if (!active) return
    let cancelled = false
    void window.bingbong.timer.get().then((current) => {
      if (!cancelled) setState(current)
    })
    const unsubscribe = window.bingbong.timer.onChange(setState)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [active])

  return state
}
