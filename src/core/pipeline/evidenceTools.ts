// The Evidence Checkpoint tool (#121, ADR 0028): the orchestrator's one
// path for a grounded web Observation to enter Session Evidence mid-Run —
// immediately, under Memory Entry identity, surviving later failure or
// cancellation of the originating Run. Bookkeeping, not acquisition: it
// stays available through Finalization and never gates on risk or history.
// The grounding decision itself lives in evidenceCheckpoint.ts; the tool is
// the thin model-facing surface.

import type { Tool } from './tool'
import { EVIDENCE_NO_SESSION, evidenceCheckpointMessage, type EvidenceCheckpointOutcome } from './evidenceCheckpoint'

export function createRecordEvidenceTool(): Tool {
  return {
    name: 'record_evidence',
    description:
      'Checkpoint one grounded web Observation into Session Evidence. Cite the source_url of a page this run ' +
      'opened or read, and copy the excerpt verbatim from what the tool result showed there (a structured action ' +
      'outcome grounds itself — excerpt then optional). Checkpoint only decision-relevant facts: new findings, ' +
      'candidate eliminations, or work later runs must not repeat. Checkpoints apply immediately, survive this ' +
      'run failing or being stopped, and are erased at Session Reset. Invalid citations are recoverable errors.',
    parameters: {
      observation: {
        type: 'string',
        description: 'The concise grounded statement — one decision-relevant fact.',
      },
      source_url: {
        type: 'string',
        description: 'The observed source: the URL of the page this run opened or read.',
      },
      excerpt: {
        type: 'string',
        description: 'Verbatim supporting excerpt from the tool result that observed the source.',
        required: false,
      },
      uncertainty: {
        type: 'string',
        description: 'Optional: what makes the observation less than certain.',
        required: false,
      },
    },
    async execute(call, ctx) {
      const outcome: EvidenceCheckpointOutcome = ctx.checkpointEvidence
        ? ctx.checkpointEvidence(call)
        : EVIDENCE_NO_SESSION
      if (!outcome.ok) throw new Error(evidenceCheckpointMessage(outcome))
      return evidenceCheckpointMessage(outcome)
    },
  }
}
