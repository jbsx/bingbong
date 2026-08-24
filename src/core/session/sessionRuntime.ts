import type { Clock } from '../ports/clock'
import type {
  RunId,
  SessionGeneration,
  SessionId,
  SessionIdentitySource,
  SubmissionId,
} from './sessionIdentity'

export type { SessionGeneration } from './sessionIdentity'

export type SessionPhase = 'absent' | 'active' | 'expiring'
export type SessionEndReason = 'lapsed' | 'reset' | 'app_closed' | 'interrupted'

export interface Submission {
  submissionId: SubmissionId
  submittedAt: number
}

export interface AcceptedRunAdmission {
  accepted: true
  submissionId: SubmissionId
  runId: RunId
  sessionId: SessionId
  generation: SessionGeneration
  acceptedAt: number
}

export interface SessionRuntimeState {
  phase: SessionPhase
  sessionId: SessionId | null
  generation: SessionGeneration
  startedAt: number | null
  acceptedRunIds: readonly RunId[]
  liveRunIds: readonly RunId[]
}

export interface EndedSession {
  sessionId: SessionId
  generation: SessionGeneration
  reason: SessionEndReason
  startedAt: number
  endedAt: number
  acceptedRunIds: readonly RunId[]
  liveRunIds: readonly RunId[]
}

export interface SessionRuntime {
  state(): SessionRuntimeState
  submit(): Submission
  accept(submissionId: SubmissionId): AcceptedRunAdmission
  reject(submissionId: SubmissionId): boolean
  finish(runId: RunId): boolean
  beginExpiry(): boolean
  extend(): boolean
  end(reason: SessionEndReason): EndedSession | null
}

export function createSessionRuntime(deps: {
  clock: Clock
  identities: SessionIdentitySource
}): SessionRuntime {
  let phase: SessionPhase = 'absent'
  let sessionId: SessionId | null = null
  let generation = 0
  let startedAt: number | null = null
  let acceptedRunIds: RunId[] = []
  const liveRunIds = new Set<RunId>()
  const pendingSubmissionIds = new Set<SubmissionId>()

  const state = (): SessionRuntimeState => ({
    phase,
    sessionId,
    generation,
    startedAt,
    acceptedRunIds: [...acceptedRunIds],
    liveRunIds: [...liveRunIds],
  })

  return {
    state,
    submit() {
      const submissionId = deps.identities.mintSubmissionId()
      pendingSubmissionIds.add(submissionId)
      return { submissionId, submittedAt: deps.clock.now() }
    },
    accept(submissionId) {
      if (!pendingSubmissionIds.has(submissionId)) {
        throw new Error(`Submission is unknown or already admitted: ${submissionId}`)
      }

      const acceptedAt = deps.clock.now()
      const createsSession = phase === 'absent'
      const acceptedSessionId = createsSession ? deps.identities.mintSessionId() : sessionId!
      const runId = deps.identities.mintRunId()

      pendingSubmissionIds.delete(submissionId)
      if (createsSession) {
        sessionId = acceptedSessionId
        startedAt = acceptedAt
        acceptedRunIds = []
      }
      phase = 'active'

      acceptedRunIds.push(runId)
      liveRunIds.add(runId)

      return {
        accepted: true,
        submissionId,
        runId,
        sessionId: acceptedSessionId,
        generation,
        acceptedAt,
      }
    },
    reject(submissionId) {
      return pendingSubmissionIds.delete(submissionId)
    },
    finish(runId) {
      return liveRunIds.delete(runId)
    },
    beginExpiry() {
      if (phase !== 'active' || liveRunIds.size > 0) return false
      phase = 'expiring'
      return true
    },
    extend() {
      if (phase !== 'expiring') return false
      phase = 'active'
      return true
    },
    end(reason) {
      if (phase === 'absent' || sessionId === null || startedAt === null) return null
      if (reason === 'lapsed' && (phase !== 'expiring' || liveRunIds.size > 0)) return null

      const ended: EndedSession = {
        sessionId,
        generation,
        reason,
        startedAt,
        endedAt: deps.clock.now(),
        acceptedRunIds: [...acceptedRunIds],
        liveRunIds: [...liveRunIds],
      }

      phase = 'absent'
      sessionId = null
      startedAt = null
      acceptedRunIds = []
      liveRunIds.clear()
      pendingSubmissionIds.clear()
      if (reason === 'reset') generation += 1
      return ended
    },
  }
}
