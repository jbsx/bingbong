// The Evidence Checkpoint tool (#121, ADR 0028): the orchestrator's one
// path for a grounded web Observation to enter Session Evidence mid-Run —
// immediately, under Memory Entry identity, surviving later failure or
// cancellation of the originating Run. Bookkeeping, not acquisition: it
// stays available through Finalization and never gates on risk or history.
// The grounding decision itself lives in evidenceCheckpoint.ts; the tool is
// the thin model-facing surface. Three citation kinds (#122/#123): a page
// this Run observed, the user's exact words, or a collected Subagent
// finding — workers never checkpoint for themselves.

import type { Tool } from './tool'
import { EVIDENCE_NO_SESSION, evidenceCheckpointMessage, type EvidenceCheckpointOutcome } from './evidenceCheckpoint'

export function createRecordEvidenceTool(): Tool {
  return {
    name: 'record_evidence',
    description:
      'Checkpoint one grounded Observation into Session Evidence. Web (default): cite the source_url of a page this ' +
      'run opened or read, and copy the excerpt verbatim — character-for-character copy-paste from what the tool ' +
      'result showed there; a paraphrase from memory is rejected (a structured action outcome grounds itself — ' +
      'excerpt then optional). User (kind "user"): checkpoint the user\'s exact words — the command, an ask_user ' +
      'answer, or a steering directive this run heard, copied verbatim — so corrections and constraints survive for ' +
      'the whole Session. Subagent (kind "subagent"): checkpoint a finding from a collected report — cite the ' +
      'agent_id and one of the evidence URLs its findings carry; workers cannot checkpoint for themselves. ' +
      'The excerpt rule: a source retained as text requires the excerpt, a structured action outcome grounds ' +
      'itself without one, and a subagent citation\'s excerpt is optional. ' +
      'Checkpoint only decision-relevant facts: new findings, candidate eliminations, user corrections, or work ' +
      'later runs must not repeat. Set volatile true for time-sensitive or action-critical observations — later ' +
      'runs must revalidate those (or any uncertain one) before completing on them; stable facts are reused ' +
      'as-is. Checkpoints apply immediately, survive this run failing or being stopped, and are erased at Session ' +
      'Reset. Invalid citations are recoverable errors.',
    parameters: {
      kind: {
        type: 'string',
        description:
          'What grounds the observation: "web" (default) for an observed page, "user" for the user\'s own exact words, ' +
          '"subagent" for a collected subagent finding.',
        enum: ['web', 'user', 'subagent'],
        required: false,
      },
      observation: {
        type: 'string',
        description:
          'The concise grounded statement — one decision-relevant fact. For kind "user": the user\'s exact words, verbatim.',
      },
      source_url: {
        type: 'string',
        description:
          'The observed source: the URL of the page this run opened or read — or, for kind "subagent", one of the ' +
          'evidence URLs the worker\'s findings cited. Web and subagent citations only.',
        required: false,
      },
      excerpt: {
        type: 'string',
        description:
          'A contiguous span copied character-for-character from the tool result that observed the source — ' +
          'copy-paste it; never retype or paraphrase from memory, a near-miss is rejected. If the observed text is ' +
          'no longer in front of you, re-read the source before citing. Web citations only.',
        required: false,
      },
      agent_id: {
        type: 'string',
        description: 'The subagent whose collected report grounds this finding, e.g. "a-1". Subagent citations only.',
        required: false,
      },
      uncertainty: {
        type: 'string',
        description: 'Optional: what makes the observation less than certain. Uncertain evidence counts as volatile.',
        required: false,
      },
      volatile: {
        type: 'boolean',
        description:
          'Optional: true when the fact is time-sensitive or action-critical — later runs must revalidate it before ' +
          'completing on it. Durable facts omit it.',
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
