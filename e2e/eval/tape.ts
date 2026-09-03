import type { PipelineEvent } from '../../src/core/pipeline/events'

// The tape's Subagent-card predicate (#165), kept out of the evaluator so
// it can be tested without an Electron app. Agent cards carry no turn id —
// every other tape read filters by one — so the only way to scope a card to
// the run that spawned it is positional: the tape's length at run start.

/**
 * The ids of Subagent cards still `running` in the tape slice from
 * `fromIndex` — the events of the current run. Folding the whole tape
 * instead would let one card leaked by an earlier scenario (a wedged
 * worker, a cancellation that never travelled) keep every later run
 * waiting out its full budget, and stop the wait from doing its job.
 */
export function runningAgentsSince(tape: PipelineEvent[], fromIndex: number): string[] {
  const live = new Map<string, string>()
  for (const event of tape.slice(fromIndex)) {
    if (event.type === 'agent_update') live.set(event.agent.id, event.agent.status)
  }
  return [...live.entries()].filter(([, status]) => status === 'running').map(([id]) => id)
}

/**
 * The same predicate as source text, for evaluation inside the dashboard
 * renderer where the tape lives. Transpilation strips the types, so what
 * ships is plain self-contained JavaScript.
 */
export function runningAgentsSinceSource(): string {
  return runningAgentsSince.toString()
}
