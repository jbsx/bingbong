import type { CommandPipeline } from './createCommandPipeline'
import type { Clock } from '../ports/clock'
import type { PipelineEvent } from './events'
import type { PerfTracer } from '../perf/perfTracer'
import { createTurnIdSource } from '../perf/perfTracer'
import { emitTurnSummary } from '../perf/turnSummary'
import { spokenErrorLine } from '../agent/answerContract'

// Single-shot interaction in v0.1: one command runs at a time. The busy
// rejection rides the normal event stream (command echoed, error, spoken
// one-liner, done) so the dashboard needs no special case.

export interface SingleShotPipelineDeps {
  /** Turn-id source (#28); absent falls back to a local id mint. */
  tracer?: PerfTracer
  /** Where the per-turn summary line goes (#30); defaults to console.log. */
  printSummary?: (line: string) => void
}

export function createSingleShotPipeline(
  inner: CommandPipeline,
  clock: Clock,
  deps?: SingleShotPipelineDeps,
): CommandPipeline {
  const mintTurnId = createTurnIdSource(deps?.tracer)
  let running = false

  async function* execute(command: string, turnId?: string, truncated?: boolean): AsyncIterable<PipelineEvent> {
    // A rejected submission is still an observable turn (#28): it gets the
    // submitted id (voice) or a fresh one (text box), stamped on its events.
    const id = turnId ?? mintTurnId()
    if (running) {
      const message = 'another command is already running — wait for it to finish'
      yield { type: 'command', text: command, turnId: id, at: clock.now() }
      yield { type: 'error', message, turnId: id, at: clock.now() }
      yield { type: 'speak', text: spokenErrorLine(message), turnId: id, at: clock.now() }
      yield { type: 'done', outcome: 'failed', turnId: id, at: clock.now() }
      // A rejected turn never reaches the inner run's finally (#30), so its
      // close-out happens here: a voice turn's already-recorded stt spans
      // get their summary event and console line instead of lingering as
      // turnsWithoutSummary. Ids with no spans degrade to a no-op.
      emitTurnSummary(deps?.tracer, id, deps?.printSummary ?? console.log)
      return
    }
    running = true
    try {
      yield* inner.execute(command, id, truncated)
    } finally {
      running = false
    }
  }

  return {
    execute,
    resolveConfirmation: (confirmationId, approved) => inner.resolveConfirmation(confirmationId, approved),
    resolveAsk: (askId, answer) => inner.resolveAsk(askId, answer),
    abort: () => inner.abort(),
    pause: () => inner.pause(),
    resume: (steering) => inner.resume(steering),
    getState: () => inner.getState(),
  }
}
