import { useCallback, useEffect, useRef, useState } from 'react'
import type { PipelineEvent } from '../../core/pipeline/events'
import { createSessionRuns } from '../../core/session/sessionRuns'
import { isSessionActive } from '../../core/history/hydrationScope'
import type { RunSpan } from '../../core/history/hydrationScope'
import { hydrationSnapshot } from './hydrationSnapshot'

/**
 * The Active Session gate (#70): true while the newest run finished within
 * the Session Window, or a run is in progress — computed by the same pure
 * `isSessionActive` boot hydration uses, fed live from the pipeline event
 * seam (a command opens the run's span, its done closes it) and seeded from
 * recorded history so a warm restart gates too. While true, the idle
 * timeout never swaps the dashboard for the idle screen.
 *
 * Expiry needs no event to notice: the deadline (newest finish + window)
 * re-arms a one-shot timer, covering the corners where nothing announces
 * the lapse to this window (a model-invoked clear while idle leaves no
 * thread to lapse eagerly; a hydrated boot has no live run).
 */
export function useActiveSession(windowMs: number): boolean {
  const runsRef = useRef(createSessionRuns())
  const [runs, setRuns] = useState<RunSpan[]>([])
  const [active, setActive] = useState(false)

  const evaluate = useCallback(() => {
    setActive(isSessionActive(runsRef.current.runs(), Date.now(), windowMs))
  }, [windowMs])

  const sync = useCallback(() => {
    setRuns(runsRef.current.runs())
    evaluate()
  }, [evaluate])

  // The restart seed: the same hydration snapshot the feed hydrates from
  // (one shared fetch) carries the recorded run spans.
  useEffect(() => {
    let cancelled = false
    void hydrationSnapshot()
      .then((snapshot) => {
        if (cancelled) return
        runsRef.current.hydrate(snapshot.runs)
        sync()
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sync])

  useEffect(() => window.bingbong.assistant.onEvent((event: PipelineEvent) => {
    runsRef.current.event(event)
    sync()
  }), [sync])

  // While a newest run exists, its window's expiry is a deadline — flip the
  // gate at the exact moment, not on the next event's coattails.
  useEffect(() => {
    const newest = runs.at(-1)
    if (!newest) return
    const remaining = (newest.finishedAt ?? newest.startedAt) + windowMs - Date.now()
    if (remaining <= 0) {
      evaluate()
      return
    }
    const timer = setTimeout(evaluate, remaining)
    return () => clearTimeout(timer)
  }, [runs, windowMs, evaluate])

  return active
}
