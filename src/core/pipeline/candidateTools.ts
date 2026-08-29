// The Candidate Checkpoint tool (#122, ADR 0028): the orchestrator's one
// path for grounded Candidates to enter Session Evidence — creation
// active, then acceptance, rejection, or supersession, each citing live
// supporting Observations. Bookkeeping, not acquisition: it stays
// available through Finalization and never gates on risk or history.
// The grounding decision lives in candidateCheckpoint.ts; the tool is
// the thin model-facing surface.

import type { Tool } from './tool'
import {
  CANDIDATE_NO_SESSION,
  candidateCheckpointMessage,
  type CandidateCheckpointOutcome,
} from './candidateCheckpoint'

export function createRecordCandidateTool(): Tool {
  return {
    name: 'record_candidate',
    description:
      'Record or decide one Candidate in Session Evidence — a possible answer, item, or option the run is weighing. ' +
      'Create it active with {subject, detail?, supporting_evidence: [Session Evidence observation ids]}; decide it ' +
      'with {candidate_id, status: accepted|rejected|superseded, supporting_evidence} citing fresh Observations that ' +
      'ground the decision. Record user corrections as rejections with kind "user" record_evidence support so ' +
      'eliminated Candidates do not reappear later in the Session. Statuses are retained, not replayed; prior ' +
      'provenance is preserved. Checkpoints apply immediately, survive this run failing or being stopped, and are ' +
      'erased at Session Reset. Invalid calls are recoverable errors.',
    parameters: {
      subject: {
        type: 'string',
        description: 'Creation only: the Candidate in one line — what it is an option for.',
        required: false,
      },
      detail: {
        type: 'string',
        description: 'Creation only, optional: the distinguishing detail.',
        required: false,
      },
      candidate_id: {
        type: 'string',
        description: 'Decision only: the memory-N identity the creation call returned.',
        required: false,
      },
      status: {
        type: 'string',
        description: 'Decision only: the terminal verdict — accepted, rejected, or superseded.',
        enum: ['accepted', 'rejected', 'superseded'],
        required: false,
      },
      supporting_evidence: {
        type: 'array',
        items: { type: 'string' },
        description:
          'The memory-N ids of live Session Evidence Observations supporting the creation or the decision — ' +
          'from record_evidence results or the Session Evidence block.',
      },
    },
    async execute(call, ctx) {
      const outcome: CandidateCheckpointOutcome = ctx.checkpointCandidate
        ? ctx.checkpointCandidate(call)
        : CANDIDATE_NO_SESSION
      if (!outcome.ok) throw new Error(candidateCheckpointMessage(outcome))
      return candidateCheckpointMessage(outcome)
    },
  }
}
