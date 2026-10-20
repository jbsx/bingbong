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
 * activity. The timeout comes from the launch config snapshot. The idle
 * shortcut (Ctrl/Cmd+Shift+L, heard in main) enters idle at once.
 *
 * Over the Idle Screen (#361) a key is main's: one that types opens the
 * Idle Prompt and one that types nothing is swallowed there, so neither
 * wakes; nor does a chord (a shortcut) or a key typed into the Prompt. A
 * tap wakes only while `tapWakes` holds — with no page in the pane there
 * is nothing to wake to.
 */
export function useIdle(options: { tapWakes: () => boolean }): IdleApi {
  const [idle, setIdle] = useState(true)
  const pingRef = useRef<() => void>(() => {})
  const idleRef = useRef<() => void>(() => {})
  const tapWakesRef = useRef(options.tapWakes)
  tapWakesRef.current = options.tapWakes

  useEffect(() => {
    const timer = createIdleTimer({
      clock: systemClock,
      timeoutMs: window.bingbong.app.idleTimeoutMs,
      startIdle: true,
      onChange: setIdle,
    })
    pingRef.current = () => timer.ping()
    idleRef.current = () => timer.idle()
    const onPointer = (): void => {
      if (!timer.isIdle() || tapWakesRef.current()) timer.ping()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (timer.isIdle() && (event.ctrlKey || event.metaKey || event.altKey || (event.target instanceof Element && event.target.closest('.idle-prompt') !== null))) return
      timer.ping()
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    const unsubscribeShortcut = window.bingbong.idle.onEnter(() => timer.idle())
    return () => {
      unsubscribeShortcut()
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
      pingRef.current = () => {}
      idleRef.current = () => {}
      timer.dispose()
    }
  }, [])

  const ping = useCallback(() => pingRef.current(), [])
  const idleNow = useCallback(() => idleRef.current(), [])
  return { idle, ping, idleNow }
}
