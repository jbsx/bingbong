import type { SubmissionId } from './sessionIdentity'

export interface SubmissionFeedback {
  type: 'submission_rejected'
  reason: 'busy'
  submissionId: SubmissionId
  message: string
  at: number
}
