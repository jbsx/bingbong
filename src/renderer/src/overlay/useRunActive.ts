import { useEffect, useRef, useState } from 'react'
import { createRunProgressTracker } from '../../../core/pipeline/runProgress'

// The steer box's enable state (#46): a run is active while the progress
// tracker holds a stage — the same fold that drives the dashboard's hint
// line, so "can I steer?" and "what is it doing?" answer from one
// projection. Paused runs stay active: steering while paused is the
// canonical voice pattern.
export function useRunActive(): boolean {
  const tracker = useRef(createRunProgressTracker())
  const [active, setActive] = useState(false)

  useEffect(() => {
    const unsubscribe = window.bingbong.assistant.onEvent((event) => {
      tracker.current.onEvent(event)
      setActive(tracker.current.current() !== null)
    })
    return unsubscribe
  }, [])

  return active
}
