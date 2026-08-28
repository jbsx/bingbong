import type { PipelineEvent } from '../pipeline/events'
import { inferRunOutcome } from '../pipeline/events'
import type { EffortTier } from '../pipeline/runPlan'
import type { SessionId } from '../session/sessionIdentity'
import type { VoiceHeardEvent } from '../voice/ipcChannels'
import { describeHeard } from '../voice/heardDisplay'
import type { HistoryStore } from './historyStore'
import { projectPipelineEvent } from './transcriptProjection'

// Projects the dashboard's own event streams (pipeline events, heard voice,
// voice errors) onto the history store, mirroring the renderer's transcript
// word-for-word for explicit Recorded History review.

export interface HistoryRecorder {
  /** One independent command execution; concurrent attempts cannot collide. */
  run(): { event(pipelineEvent: PipelineEvent): void }
  /** Auxiliary pipeline events (downloads/subagents) attach to the active run. */
  event(pipelineEvent: PipelineEvent): void
  /** `sessionId` attributes run-less voice records to their Session (#85). */
  heard(heard: VoiceHeardEvent, sessionId?: SessionId | null): void
  voiceError(message: string, at?: number, sessionId?: SessionId | null): void
}

export function createHistoryRecorder(
  store: HistoryStore,
  deps: { now(): number },
): HistoryRecorder {
  const activeRunIds: number[] = []
  const activeRunId = (): number | null => activeRunIds[0] ?? null
  const removeActiveRun = (runId: number): void => {
    const index = activeRunIds.indexOf(runId)
    if (index !== -1) activeRunIds.splice(index, 1)
  }

  const append = (
    kind: 'command' | 'tool' | 'display' | 'speak' | 'error' | 'voice',
    text: string,
    at: number,
    sessionId: SessionId | null,
    targetRunId = activeRunId(),
  ): void => {
    store.appendEntry({ runId: targetRunId, sessionId, kind, text, at })
  }

  return {
    run() {
      let runId: number | null = null
      let sessionId: SessionId | null = null
      let lastStatus: string | null = null
      let failed = false
      // The Effort Tier (#116): the latest plan this run reported. A run
      // that never reported one ran under the default Lookup plan.
      let effortTier: EffortTier | null = null

      return {
        event(event) {
          switch (event.type) {
            case 'command': {
              if (runId !== null) {
                store.finishRun(runId, 'interrupted', event.at)
                removeActiveRun(runId)
              }
              // The run row adopts the turn's id (#28): a logged turn maps
              // 1:1 to a row in the review-only history database. Every new
              // row also carries its owning Session (#100) — the publisher's
              // accepted-Run ownership stamps it on every event it emits.
              if (event.sessionId === undefined) {
                throw new Error(
                  `command event for turn ${event.turnId} carries no Session identity — ` +
                    'every accepted Run is published with one (#85)',
                )
              }
              sessionId = event.sessionId
              runId = store.startRun(event.text, event.at, event.turnId, sessionId)
              activeRunIds.push(runId)
              lastStatus = null
              failed = false
              const projected = projectPipelineEvent(event)
              if (projected) append(projected.kind, projected.text, projected.at, sessionId, runId)
              return
            }
            case 'status':
              lastStatus = event.status
              return
            case 'run_plan':
              // The Run Plan (#116) records no transcript entry; only its
              // tier rides the run row.
              effortTier = event.effortTier
              return
            case 'done': {
              if (runId !== null) {
                const outcome = inferRunOutcome(event.outcome, lastStatus, failed)
                // Semantic finalization fields (#110) ride the done event
                // additively; absent fields stay null columns. The Effort
                // Tier (#116) defaults to Lookup — the plan a run without
                // a declaration ran under.
                store.finishRun(runId, outcome, event.at, {
                  resolution: event.resolution ?? null,
                  finalizationCause: event.finalizationCause ?? null,
                }, effortTier ?? 'lookup')
                removeActiveRun(runId)
                runId = null
              }
              lastStatus = null
              failed = false
              effortTier = null
              return
            }
            default: {
              if (event.type === 'error') failed = true
              const projected = projectPipelineEvent(event)
              if (projected) {
                append(projected.kind, projected.text, projected.at, sessionId ?? event.sessionId ?? null, runId ?? undefined)
              }
            }
          }
        },
      }
    },
    event(event) {
      const projected = projectPipelineEvent(event)
      if (projected) append(projected.kind, projected.text, projected.at, event.sessionId ?? null)
    },
    heard(heard, sessionId = null) {
      // Commands are echoed by the pipeline itself; only answers and
      // undecided words land in the transcript.
      if (heard.routed === 'command') return
      append('voice', describeHeard(heard), heard.at ?? deps.now(), sessionId)
    },
    voiceError(message, at = deps.now(), sessionId = null) {
      append('error', `voice: ${message}`, at, sessionId)
    },
  }
}
