import { useEffect } from 'react'
import { createIdleTimer } from '../../core/idle/idleTimer'
import { systemClock } from '../../core/ports/clock'

/** How long the pointer lies still before it is hidden, as a media player hides it over a playing film. */
export const CURSOR_REST_MS = 3000

/** The class on <html> that hides the pointer over everything, the Idle Prompt and the cards' own pointers too. */
export const CURSOR_HIDDEN_CLASS = 'cursor-hidden'

/**
 * The cursor at rest over the Idle Screen: hidden from the moment the
 * screen shows, and again once still for CURSOR_REST_MS; a move shows it
 * and starts the count over. The settings glyph rides the same rest. Moving
 * never wakes the screen (only a press does, useIdle), so a kiosk's
 * pointer goes away and stays away until someone reaches for the mouse.
 * Mounted with the screen, so leaving it always brings the cursor back.
 */
export function useCursorRest(): void {
  useEffect(() => {
    const root = document.documentElement
    const timer = createIdleTimer({
      clock: systemClock,
      timeoutMs: CURSOR_REST_MS,
      startIdle: true,
      onChange: (still) => root.classList.toggle(CURSOR_HIDDEN_CLASS, still),
    })
    root.classList.add(CURSOR_HIDDEN_CLASS)
    const onMove = (): void => timer.ping()
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerdown', onMove)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onMove)
      timer.dispose()
      root.classList.remove(CURSOR_HIDDEN_CLASS)
    }
  }, [])
}
