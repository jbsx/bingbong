import { randomUUID } from 'node:crypto'
import type { RunId, SessionId, SessionIdentitySource, SubmissionId } from '../../core/session/sessionIdentity'

export function createSessionIdentitySource(): SessionIdentitySource {
  return {
    mintSubmissionId: () => `submission-${randomUUID()}` as SubmissionId,
    mintRunId: () => `run-${randomUUID()}` as RunId,
    mintSessionId: () => `session-${randomUUID()}` as SessionId,
  }
}
