import { useEffect, useState } from 'react'
import type { TimerState } from '../../core/timer/timer'

/**
 * The Timer (CONTEXT.md) for the Idle Screen and the Toolbar's widgets:
 * pulled on mount, since it may have been set before, and followed as it
 * runs out, rings and is dismissed.
 */
export function useTimer(): TimerState {
  const [state, setState] = useState<TimerState>({ status: 'off' })

  useEffect(() => {
    let cancelled = false
    void window.bingbong.timer.get().then((current) => {
      if (!cancelled) setState(current)
    })
    const unsubscribe = window.bingbong.timer.onChange(setState)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return state
}
