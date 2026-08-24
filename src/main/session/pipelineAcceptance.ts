import type { PipelineEvent } from '../../core/pipeline/events'
import type { SessionGeneration, SessionId } from '../../core/session/sessionIdentity'

// The pipeline acceptance rule every window consumer shares (#91, reused by
// #97): only work belonging to the live Session may render, record, or
// speak. Legacy unowned clear-only session_started boundaries pass, a
// session_ended must match the Session that just ended, and everything else
// — Run output, subagent cards and announcements, detail signals — must
// carry the live Session's identity. Late asynchronous work from an ended
// or foreign Session is rejected here, before any observer sees it.

export interface PipelineAcceptanceInputs {
  /** The live Session runtime state, read at gate time; undefined before boot. */
  liveSession(): { sessionId: SessionId | null; generation: SessionGeneration } | undefined
  /** The most recently ended Session, if any — the one session_ended may match. */
  lastEndedSession(): { sessionId: SessionId; generation: SessionGeneration } | null
}

export type PipelineAcceptanceGate = (event: PipelineEvent) => boolean

export function createPipelineAcceptanceGate(inputs: PipelineAcceptanceInputs): PipelineAcceptanceGate {
  return (event) => {
    // The current new_session tool still emits an unowned clear-only
    // boundary. Lapse and true Session starts/ends are identity-bearing.
    if (event.type === 'session_started' && event.sessionId === undefined) return true
    if (event.type === 'session_ended') {
      const ended = inputs.lastEndedSession()
      return ended !== null && event.sessionId === ended.sessionId &&
        event.sessionGeneration === ended.generation
    }
    const state = inputs.liveSession()
    return state !== undefined && state.sessionId !== null &&
      event.sessionId === state.sessionId &&
      event.sessionGeneration === state.generation
  }
}
