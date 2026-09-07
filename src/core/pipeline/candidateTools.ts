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
      'with {candidate_id, status: accepted|rejected|superseded|active, reason, supporting_evidence, authority?} ' +
      'citing fresh Observations that ground the decision. These are the only two shapes and they never mix: no ' +
      'status on creation (creation makes it active), no subject on a decision, and supporting_evidence always ' +
      'cites memory-N ids that already exist. Every decision is scoped to the objective in force and stamped with ' +
      'who made it. Record a user correction as authority "user", citing the kind "user" Observation holding their ' +
      'own words: it then stands for that objective until the user themselves reopens it, however promising the ' +
      'Candidate later looks. Your own elimination stands for that objective until you cite an Observation it did ' +
      'not already rest on. A rejection is scoped, not global: it does not ban that source for a different ' +
      'objective. Every earlier decision is kept with its reason and provenance. ' +
      'Checkpoints apply immediately, survive this run failing or being stopped, and are erased at Session Reset. ' +
      'Invalid calls are recoverable errors.',
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
        description:
          'Decision only: the verdict — accepted, rejected, or superseded; or active to reopen what was decided ' +
          'for this objective before.',
        enum: ['accepted', 'rejected', 'superseded', 'active'],
        required: false,
      },
      reason: {
        type: 'string',
        description:
          'Decision only, required: why, in one line — what this decision rests on, so it can be weighed and ' +
          'reconsidered later rather than only repeated.',
        required: false,
      },
      authority: {
        type: 'string',
        description:
          'Decision only: "user" when the user themselves decided it — cite the kind "user" Observation holding ' +
          'their words — otherwise "model", the default, for your own judgement.',
        enum: ['user', 'model'],
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
