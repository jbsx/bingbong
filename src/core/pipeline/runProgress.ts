import type { PipelineEvent, PipelineStatus } from './events'

// Progress projection (#43): the header hint's state, as a pure function
// over the pipeline event stream. The stage and its start come from status
// events; the agent-wait signal comes from its detail variant
// (waiting_on_agents); live agent counts come from agent_update cards.
// A model retry (llm_retry) changes nothing here: the hint does not count
// the application's retries (#315, ADR 0038), and the climbing elapsed
// counter is what says the Run is alive. Elapsed time is computed by the
// caller's clock — the renderer ticks over the event timestamps, so there
// is no per-second heartbeat IPC.

/** What the header hint renders for the active run. */
export interface RunProgress {
  stage: PipelineStatus
  /** Wall-clock `at` of the stage's status event — the elapsed anchor. */
  startedAt: number
  /** Set while the run is blocked in agent_results(wait). */
  waitingOnAgents: { running: number } | null
}

/**
 * Folds pipeline events into the current RunProgress. Pure and renderer-
 * agnostic: the same seam the transcript projection occupies. Agent cards
 * persist across turns (background agents outlive their spawning turn),
 * so the live running count survives turn boundaries.
 */
export function createRunProgressTracker(): {
  onEvent(event: PipelineEvent): void
  current(): RunProgress | null
} {
  let progress: RunProgress | null = null
  // Turn-scoped by check, not convention: detail and status events from a
  // turn other than the active one (a straggler after done, an
  // overlapping rejected submission) cannot corrupt the live hint.
  let activeTurn: string | null = null
  const agentStatuses = new Map<string, string>()
  const liveRunning = (): number => {
    let running = 0
    for (const status of agentStatuses.values()) if (status === 'running') running += 1
    return running
  }

  return {
    onEvent(event) {
      switch (event.type) {
        case 'command':
          // A new turn resets; its first status event follows immediately.
          activeTurn = event.turnId
          progress = null
          return
        case 'status':
          if (event.turnId !== activeTurn) return
          // A stage transition restarts the elapsed anchor and invalidates
          // the previous stage's detail signals.
          progress = { stage: event.status, startedAt: event.at, waitingOnAgents: null }
          return
        case 'waiting_on_agents':
          if (activeTurn === null || event.turnId !== activeTurn) return
          if (progress) {
            // Live cards are more honest than the snapshot; the snapshot
            // covers streams that carry no agent_update events (tests).
            progress = {
              ...progress,
              waitingOnAgents: { running: agentStatuses.size > 0 ? liveRunning() : event.running },
            }
          }
          return
        case 'agent_update':
          agentStatuses.set(event.agent.id, event.agent.status)
          if (progress?.waitingOnAgents) {
            progress = { ...progress, waitingOnAgents: { running: liveRunning() } }
          }
          return
        case 'done':
          if (event.turnId !== activeTurn) return
          activeTurn = null
          progress = null
          return
        case 'session_ended':
          activeTurn = null
          progress = null
          agentStatuses.clear()
          return
        default:
          return
      }
    },
    current: () => progress,
  }
}

/**
 * The hint line for an active run: stage, a climbing elapsed counter
 * (the honest-hang signal — Stop stays the only escape), and the agents
 * it is waiting on when it is.
 */
export function describeRunProgress(progress: RunProgress, now: number): string {
  const seconds = Math.max(0, Math.floor((now - progress.startedAt) / 1000))
  let text = `${progress.stage} — ${seconds}s`
  if (progress.waitingOnAgents) {
    text += ` · waiting on agents (${progress.waitingOnAgents.running} running)`
  }
  return text
}
