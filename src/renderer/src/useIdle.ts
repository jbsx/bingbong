import { useCallback, useEffect, useRef, useState } from 'react'
import { createIdleTimer } from '../../core/idle/idleTimer'
import { systemClock } from '../../core/ports/clock'

export interface IdleApi {
  idle: boolean
  /** Record activity: resets the countdown and exits the idle screen. */
  ping(): void
}

/**
 * Inactivity countdown for the idle screen (T11). Pointer/keyboard input is
 * tracked here; callers ping for non-input activity (pipeline events, voice
 * state changes). The timeout comes from the launch config snapshot.
 */
export function useIdle(): IdleApi {
  const [idle, setIdle] = useState(false)
  const pingRef = useRef<() => void>(() => {})

  useEffect(() => {
    const timer = createIdleTimer({
      clock: systemClock,
      timeoutMs: window.bingbong.app.idleTimeoutMs,
      onChange: setIdle,
    })
    pingRef.current = () => timer.ping()
    const onInput = () => timer.ping()
    window.addEventListener('pointerdown', onInput)
    window.addEventListener('keydown', onInput)
    return () => {
      window.removeEventListener('pointerdown', onInput)
      window.removeEventListener('keydown', onInput)
      pingRef.current = () => {}
      timer.dispose()
    }
  }, [])

  const ping = useCallback(() => pingRef.current(), [])
  return { idle, ping }
}
