import { useEffect, useRef, useState } from 'react'
import { createRunProgressTracker, type RunProgress } from '../../../core/pipeline/runProgress'

// The prompt bar's verb signal (#46) and the Peek Card's live step (ADR
// 0029) ride one fold: a run is active while the progress tracker holds a
// stage — the same projection that drives the dashboard's hint line, so
// "will this steer or submit?" and "what is it doing?" answer from one
// place. Paused runs stay active: steering while paused is the canonical
// voice pattern.
export function useRunProgress(): RunProgress | null {
  const tracker = useRef(createRunProgressTracker())
  const [progress, setProgress] = useState<RunProgress | null>(null)

  useEffect(() => {
    const unsubscribe = window.bingbong.assistant.onEvent((event) => {
      tracker.current.onEvent(event)
      setProgress(tracker.current.current())
    })
    return unsubscribe
  }, [])

  return progress
}
