// The Run Trace (#180, ADR 0030): a durable, machine-readable record of a
// Run's internal decisions, written for diagnosis only. It is never
// rendered in any view and never provides continuity to a Session — it
// lives beside the perf logs, not in Recorded History, because Session
// Evidence must never be recoverable from the history database. The file
// is a contract: every record carries a version and the identities that
// join it to Recorded History and to the eval tape.

import type { ObservationProducer } from '../session/observationLedger'
import type { RunId, SessionGeneration, SessionId } from '../session/sessionIdentity'

/** The record-shape version every line carries; bump it when a field's meaning changes. */
export const RUN_TRACE_VERSION = 1

/** How much of a graded observation's retained text a record keeps. */
export const TRACE_PAYLOAD_HEAD_CHARS = 500

/** The Run whose decisions a trace file's records describe. */
export interface RunTraceIdentity {
  readonly runId: RunId
  readonly sessionId: SessionId
  /** The Session generation the Run was admitted under (#111). */
  readonly generation: SessionGeneration
}

/**
 * One Run Observation as the grading saw it: enough to tell from the file
 * alone which retention was checked and what it actually held — a Look
 * shadowing a page read is two entries here, one matched, one not.
 */
export interface TracedObservation {
  readonly observationId: string
  readonly producer: ObservationProducer
  /** When the observation was made, not when it was traced. */
  readonly observedAt: number
  /** Length of the retained text in characters, before the head is cut. */
  readonly payloadChars: number
  readonly payloadHead: string
  readonly sourceUrl?: string
  /** Whether this record is the one that grounded the citation. */
  readonly matched: boolean
}

/**
 * What happened to one Evidence Checkpoint attempt (#180): the raw call as
 * the model wrote it, every retention it was graded against, and the
 * verdict. Recorded History keeps only the display line and the error
 * text; this is where a rejected or vanished checkpoint is diagnosed.
 */
export interface EvidenceCheckpointEvent {
  readonly kind: 'evidence_checkpoint'
  readonly tool: 'record_evidence' | 'record_candidate'
  /** The model's arguments verbatim — never normalized, never trimmed. */
  readonly args: Record<string, unknown>
  /** 'accepted', or the outcome's rejection reason. */
  readonly outcome: string
  /**
   * Whether a record in `graded` grounded the citation. Always false where
   * grading is Session-side and nothing was graded against the Run's
   * ledger (`record_candidate`) — `outcome` carries the verdict, `matched`
   * only ever describes the graded set.
   */
  readonly matched: boolean
  readonly graded: readonly TracedObservation[]
  /** The excerpt as grading normalized it, when the call carried one. */
  readonly excerpt?: string
  /** The Memory Entry the checkpoint became, on success. */
  readonly entryId?: string
  /** The delegated worker whose observations graded a subagent citation (#123). */
  readonly agentId?: string
}

/** What a Run hands the writer: one event, stamped with the turn it happened in. */
export type RunTraceEvent = { readonly turnId: string } & EvidenceCheckpointEvent

/** One line of a trace file. */
export type RunTraceRecord = RunTraceEvent &
  RunTraceIdentity & {
    readonly v: number
    /** Wall-clock epoch ms when the record was written. */
    readonly at: number
  }

export interface RunTraceSink {
  write(record: RunTraceRecord): void
}

/**
 * What a Run calls to trace one decision; absent when nothing is tracing.
 * The event is built lazily, inside the writer's own guard, so assembling
 * a record can no more break the Run than writing one can.
 */
export type RunTraceWriter = (event: () => RunTraceEvent) => void

/**
 * Binds a sink to one Run's identity. Diagnosis must never become the
 * Run's problem: both building the record and writing it happen inside
 * one guard, so a dead logs dir — or a payload that resists
 * serialization — degrades to a Run that simply leaves no trace, never to
 * a decision that reports a failure it did not have.
 */
export function createRunTraceWriter(deps: {
  sink: RunTraceSink
  now(): number
  identity: RunTraceIdentity
}): RunTraceWriter {
  return (event) => {
    try {
      deps.sink.write({
        v: RUN_TRACE_VERSION,
        at: deps.now(),
        runId: deps.identity.runId,
        sessionId: deps.identity.sessionId,
        generation: deps.identity.generation,
        ...event(),
      })
    } catch {
      // A failed trace must never break the decision it is recording.
    }
  }
}
