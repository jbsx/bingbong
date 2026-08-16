import type { CommandPipeline } from './createCommandPipeline'
import type { Clock } from '../ports/clock'
import type { PipelineEvent } from './events'
import { spokenErrorLine } from '../agent/answerContract'

// Single-shot interaction in v0.1: one command runs at a time. The busy
// rejection rides the normal event stream (command echoed, error, spoken
// one-liner, done) so the dashboard needs no special case.
export function createSingleShotPipeline(inner: CommandPipeline, clock: Clock): CommandPipeline {
  let running = false

  async function* execute(command: string): AsyncIterable<PipelineEvent> {
    if (running) {
      const message = 'another command is already running — wait for it to finish'
      yield { type: 'command', text: command, at: clock.now() }
      yield { type: 'error', message, at: clock.now() }
      yield { type: 'speak', text: spokenErrorLine(message), at: clock.now() }
      yield { type: 'done', at: clock.now() }
      return
    }
    running = true
    try {
      yield* inner.execute(command)
    } finally {
      running = false
    }
  }

  return {
    execute,
    resolveConfirmation: (confirmationId, approved) => inner.resolveConfirmation(confirmationId, approved),
  }
}
