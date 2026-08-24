// Idle timeout for the appliance mode (T11): after inactivity the dashboard
// swaps to the idle screen. Any activity — a command, a pipeline event, a
// voice event, a tap — pings the timer. The clock is the injected seam, so
// timeout logic is provable without real time passing.

import type { Clock } from '../ports/clock'

export interface IdleTimer {
  isIdle(): boolean
  /** Record activity: resets the countdown, and wakes the timer when idle. */
  ping(): void
  /** Enter the rest state immediately; the next real input may wake it. */
  idle(): void
  dispose(): void
}

export function createIdleTimer(deps: {
  clock: Clock
  timeoutMs: number
  /** Boot straight into idle (appliance mode): no countdown until the first ping. */
  startIdle?: boolean
  onChange(idle: boolean): void
}): IdleTimer {
  let idle = deps.startIdle ?? false
  let disposed = false
  let cancel: (() => void) | null = null

  const arm = () => {
    cancel?.()
    cancel = deps.clock.setTimer(deps.timeoutMs, () => {
      idle = true
      deps.onChange(true)
    })
  }
  if (!idle) arm()

  return {
    isIdle: () => idle,
    ping() {
      if (disposed) return
      const wasIdle = idle
      idle = false
      arm()
      if (wasIdle) deps.onChange(false)
    },
    idle() {
      if (disposed || idle) return
      cancel?.()
      idle = true
      deps.onChange(true)
    },
    dispose() {
      disposed = true
      cancel?.()
    },
  }
}
