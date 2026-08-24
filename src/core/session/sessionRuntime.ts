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
  createsSession: boolean
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

export interface ExpiringSession {
  sessionId: SessionId
  generation: SessionGeneration
  at: number
  expiresAt: number
}

export type ExtendedSession = ExpiringSession

export interface SessionDecision {
  sessionId: SessionId
  generation: SessionGeneration
}

export interface SessionRuntime {
  state(): SessionRuntimeState
  submit(): Submission
  accept(submissionId: SubmissionId): AcceptedRunAdmission
  reject(submissionId: SubmissionId): boolean
  finish(runId: RunId): boolean
  beginExpiry(): boolean
  extend(decision: SessionDecision): boolean
  decline(decision: SessionDecision): EndedSession | null
  end(reason: SessionEndReason): EndedSession | null
  dispose(): void
}

export function createSessionRuntime(deps: {
  clock: Clock
  identities: SessionIdentitySource
  inactivityMs?: number
  warningLeadMs?: number
  onExpiring?: (session: ExpiringSession) => void
  onExtended?: (session: ExtendedSession) => void
  onEnded?: (session: EndedSession) => void
}): SessionRuntime {
  if (deps.inactivityMs !== undefined) {
    if (!Number.isFinite(deps.inactivityMs) || deps.inactivityMs <= 0) {
      throw new Error('inactivityMs must be positive')
    }
    if (deps.warningLeadMs === undefined || !Number.isFinite(deps.warningLeadMs) || deps.warningLeadMs <= 0) {
      throw new Error('warningLeadMs must be positive when inactivityMs is configured')
    }
    if (deps.warningLeadMs >= deps.inactivityMs) {
      throw new Error('warningLeadMs must be shorter than inactivityMs')
    }
  }
  let phase: SessionPhase = 'absent'
  let sessionId: SessionId | null = null
  let generation = 0
  let startedAt: number | null = null
  let acceptedRunIds: RunId[] = []
  const liveRunIds = new Set<RunId>()
  const pendingSubmissionIds = new Set<SubmissionId>()
  let cancelWarning: (() => void) | null = null
  let cancelDeadline: (() => void) | null = null
  let deadlineAt: number | null = null

  const cancelExpiry = (): void => {
    cancelWarning?.()
    cancelDeadline?.()
    cancelWarning = null
    cancelDeadline = null
    deadlineAt = null
  }

  const endSession = (reason: SessionEndReason): EndedSession | null => {
    if (phase === 'absent' || sessionId === null || startedAt === null) return null
    if (reason === 'lapsed' && (phase !== 'expiring' || liveRunIds.size > 0)) return null

    cancelExpiry()
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
    deps.onEnded?.(ended)
    return ended
  }

  const warn = (): void => {
    cancelWarning = null
    if (phase !== 'active' || liveRunIds.size > 0 || sessionId === null || deadlineAt === null) return
    phase = 'expiring'
    deps.onExpiring?.({ sessionId, generation, at: deps.clock.now(), expiresAt: deadlineAt })
  }

  const lapse = (): void => {
    cancelDeadline = null
    if (phase !== 'expiring' || liveRunIds.size > 0) return
    endSession('lapsed')
  }

  const armInactivity = (): number | null => {
    cancelExpiry()
    if (
      deps.inactivityMs === undefined ||
      deps.warningLeadMs === undefined ||
      phase !== 'active' ||
      liveRunIds.size > 0
    ) return null
    deadlineAt = deps.clock.now() + deps.inactivityMs
    cancelWarning = deps.clock.setTimer(deps.inactivityMs - deps.warningLeadMs, warn)
    cancelDeadline = deps.clock.setTimer(deps.inactivityMs, lapse)
    return deadlineAt
  }

  const state = (): SessionRuntimeState => ({
    phase,
    sessionId,
    generation,
    startedAt,
    acceptedRunIds: [...acceptedRunIds],
    liveRunIds: [...liveRunIds],
  })

  const matchesExpiringSession = (decision: SessionDecision): boolean =>
    phase === 'expiring' && sessionId === decision.sessionId && generation === decision.generation

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
      cancelExpiry()

      acceptedRunIds.push(runId)
      liveRunIds.add(runId)

      return {
        accepted: true,
        submissionId,
        runId,
        sessionId: acceptedSessionId,
        generation,
        acceptedAt,
        createsSession,
      }
    },
    reject(submissionId) {
      return pendingSubmissionIds.delete(submissionId)
    },
    finish(runId) {
      const finished = liveRunIds.delete(runId)
      if (finished && liveRunIds.size === 0) armInactivity()
      return finished
    },
    beginExpiry() {
      if (phase !== 'active' || liveRunIds.size > 0) return false
      phase = 'expiring'
      return true
    },
    extend(decision) {
      if (!matchesExpiringSession(decision)) return false
      phase = 'active'
      const expiresAt = armInactivity()
      if (expiresAt !== null && sessionId !== null) {
        deps.onExtended?.({ sessionId, generation, at: deps.clock.now(), expiresAt })
      }
      return true
    },
    decline(decision) {
      return matchesExpiringSession(decision) ? endSession('lapsed') : null
    },
    end(reason) {
      return endSession(reason)
    },
    dispose() {
      cancelExpiry()
    },
  }
}
