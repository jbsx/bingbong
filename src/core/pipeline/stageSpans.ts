import type { PipelineEvent } from './events'
import { createRunProgressTracker, type RunProgress } from './runProgress'
import { STAGE_SPAN_PREFIX } from '../perf/lifecycleTelemetry'

// The capsule's stages timed (#442): the same fold the Status Capsule
// reads, so a stage's span is exactly the seconds the hint counted — from
// its start to the next stage or its turn's end. `pnpm perf:report` prints
// their p95s, which date each stage's "still …" bound (STUCK_STAGE_MS).

/** One finished stage: its span name (`stage-<status>`), its length and its Hop. */
export type StageSpan = (stage: string, durMs: number, detail: { hop?: number }) => void

export function createStageSpans(span: StageSpan): (event: PipelineEvent) => void {
  const tracker = createRunProgressTracker()
  let open: RunProgress | null = null
  return (event) => {
    tracker.onEvent(event)
    const next = tracker.current()
    if (open !== null && (next === null || next.stage !== open.stage || next.startedAt !== open.startedAt)) {
      // A Stop's mark is no wait.
      if (open.stage !== 'cancelled') span(`${STAGE_SPAN_PREFIX}${open.stage}`, Math.max(0, event.at - open.startedAt), open.hop !== undefined ? { hop: open.hop } : {})
    }
    open = next
  }
}
