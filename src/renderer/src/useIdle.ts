import { useCallback, useEffect, useRef, useState } from 'react'
import { createIdleTimer } from '../../core/idle/idleTimer'
import { systemClock } from '../../core/ports/clock'

export interface IdleApi {
  idle: boolean
  /** Record activity: resets the countdown and exits the idle screen. */
  ping(): void
  /** Enter idle immediately on an explicit Session end. */
  idleNow(): void
}

/**
 * Inactivity countdown for the idle screen (T11). The app boots into idle —
 * the idle screen is the rest state; any interaction (input, a wake, a
 * command) wakes the dashboard, and the countdown only runs from there.
 * Pointer/keyboard input is tracked here; callers ping for non-input
 * activity. The timeout comes from the launch config snapshot.
 */
export function useIdle(): IdleApi {
  const [idle, setIdle] = useState(true)
  const pingRef = useRef<() => void>(() => {})
  const idleRef = useRef<() => void>(() => {})

  useEffect(() => {
    const timer = createIdleTimer({
      clock: systemClock,
      timeoutMs: window.bingbong.app.idleTimeoutMs,
      startIdle: true,
      onChange: setIdle,
    })
    pingRef.current = () => timer.ping()
    idleRef.current = () => timer.idle()
    const onInput = () => timer.ping()
    window.addEventListener('pointerdown', onInput)
    window.addEventListener('keydown', onInput)
    return () => {
      window.removeEventListener('pointerdown', onInput)
      window.removeEventListener('keydown', onInput)
      pingRef.current = () => {}
      idleRef.current = () => {}
      timer.dispose()
    }
  }, [])

  const ping = useCallback(() => pingRef.current(), [])
  const idleNow = useCallback(() => idleRef.current(), [])
  return { idle, ping, idleNow }
}
