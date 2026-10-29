import { useEffect, useState } from 'react'
import { lineAfter, lineShownFor, type OverlayLine } from '../../core/tts/lineOverlay'

/**
 * The line up on the Line Overlay (#513): folded from the pipeline stream,
 * gone 15 s after it was shown or replaced by the next one.
 */
export function useOverlayLine(): OverlayLine | null {
  const [line, setLine] = useState<OverlayLine | null>(null)
  useEffect(() => window.bingbong.assistant.onEvent((event) => setLine((last) => lineAfter(last, event))), [])
  useEffect(() => {
    if (line === null) return
    const timer = setTimeout(() => setLine((last) => (last === line ? null : last)), lineShownFor(line, Date.now()))
    return () => clearTimeout(timer)
  }, [line])
  return line
}

/**
 * The Line Overlay (#513): with the voice off, the line the app would have
 * said, at the glance size (ui.md 5), a failure in the failure colour beside
 * its failed chime. It is read, never acted on: no control, no focus taken.
 */
export function LineOverlay({ line }: { line: OverlayLine }) {
  return (
    <section className={`line-overlay${line.failure ? ' line-overlay--failed' : ''}`} aria-label="what the app says">
      <p className="line-overlay-text" role="status">
        {line.text}
      </p>
    </section>
  )
}
