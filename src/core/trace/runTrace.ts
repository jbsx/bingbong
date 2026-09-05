// The Run Trace (#180, ADR 0030): a durable, machine-readable record of a
// Run's internal decisions, written for diagnosis only. It is never
// rendered in any view and never provides continuity to a Session — it
// lives beside the perf logs, not in Recorded History, because Session
// Evidence must never be recoverable from the history database. The file
// is a contract: every record carries a version and the identities that
// join it to Recorded History and to the eval tape.

import type { ObservationProducer } from '../session/observationLedger'
import type { SessionEvidenceCounts } from '../session/sessionEvidence'
import type { SessionEndReason } from '../session/sessionRuntime'
import type { RunId, SessionGeneration, SessionId } from '../session/sessionIdentity'

/** The record-shape version every line carries; bump it when a field's meaning changes. */
export const RUN_TRACE_VERSION = 1

/** How much of a graded observation's retained text a record keeps. */
export const TRACE_PAYLOAD_HEAD_CHARS = 500

/** How much of a round's reasoning a `reasoning` record keeps (#182). */
export const TRACE_REASONING_MAX_CHARS = 8_000

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

/**
 * The model's own reasoning for one LLM round (#182), written only behind
 * `BINGBONG_TRACE_REASONING`. Reasoning deltas stream to the Feed as
 * ephemeral detail and are kept nowhere else, so a rejected checkpoint's
 * or an abandoned retry's private trace cannot be read back after the
 * fact. This is the record that keeps it — for the developer who opted
 * in, on their own machine, and nowhere else.
 */
export interface ReasoningEvent {
  readonly kind: 'reasoning'
  /**
   * Which LLM round of the Run thought this, counting from 1. Not the
   * Tool Round count the Effort Epoch budgets: this numbers every model
   * round, bookkeeping, reserved Answer and deadline-aborted ones
   * included, so it must not be read against a Run's round budget.
   */
  readonly round: number
  /**
   * Which attempt within that round, counting from 1. A round retried by
   * the client leaves one record per attempt — an abandoned retry's
   * thinking is exactly what this file exists to keep, and concatenating
   * it into the surviving attempt would hide that two of them happened.
   */
  readonly attempt: number
  /** The round's assembled reasoning, cut at {@link TRACE_REASONING_MAX_CHARS}. */
  readonly text: string
  /** Full length in characters before the cut, so truncation is visible. */
  readonly chars: number
}

/** One decision a Run traces, whatever kind it is. */
export type RunTraceEventBody = EvidenceCheckpointEvent | ReasoningEvent

/** What a Run hands the writer: one event, stamped with the turn it happened in. */
export type RunTraceEvent = { readonly turnId: string } & RunTraceEventBody

/** One line of a trace file written by a Run. */
export type RunTraceRecord = RunTraceEvent &
  RunTraceIdentity & {
    readonly v: number
    /** Wall-clock epoch ms when the record was written. */
    readonly at: number
  }

// The store and view records (#181). A Run's checkpoint is only half the
// question: the other half is whether the accepted checkpoint reached the
// store, and what each view was told about it. These four kinds are
// written main-side, outside any Run — so they name the Session rather
// than a turn, and a pull answered with no Session names neither.

/** The Session-bearing renderers evidence is answered to and broadcast at (#139). */
export const EVIDENCE_REQUESTERS = ['dashboard', 'feed_panel'] as const
export type EvidenceRequester = (typeof EVIDENCE_REQUESTERS)[number]

/**
 * What the store held after one retained change (#181): the counts an
 * empty panel is diagnosed against, plus the two facts a count alone
 * hides — whether the checkpoint merged into an existing Observation
 * rather than adding one, and which earlier Observations it contradicts.
 */
export interface EvidenceAcceptedEvent {
  readonly kind: 'evidence_accepted'
  /** Which retained change fired it: an Observation checkpoint or a Candidate change. */
  readonly change: 'observation' | 'candidate'
  /** The Memory Entry the change landed on. */
  readonly entryId: string
  readonly counts: SessionEvidenceCounts
  /** True when the checkpoint merged into an exact duplicate; never true for a Candidate. */
  readonly merged: boolean
  /** Prior Observations the accepted one mechanically contradicts (#143). */
  readonly contradicted: readonly string[]
}

/**
 * What main returned to one evidence pull (#181): who asked, and what
 * they were told. `no_session` is the answer a renderer reads as an empty
 * panel, so the record must distinguish it from a Session answered with
 * nothing in it.
 */
export interface EvidenceAnsweredEvent {
  readonly kind: 'evidence_answered'
  readonly requester: EvidenceRequester
  /** 'session' when a snapshot was returned, 'no_session' when the answer was null. */
  readonly answered: 'session' | 'no_session'
  /** The counts in the answered snapshot; absent on a `no_session` answer. */
  readonly counts?: SessionEvidenceCounts
}

/**
 * One change signal as it was sent (#181): the renderers alive to receive
 * it. An empty list is a change nobody was told about — the shape of a
 * correct store beside a stale view.
 */
export interface EvidenceBroadcastEvent {
  readonly kind: 'evidence_broadcast'
  readonly renderers: readonly EvidenceRequester[]
}

/** What the store held when the Session ended, and why it ended (#181). */
export interface SessionEvidenceEndEvent {
  readonly kind: 'session_evidence_end'
  readonly counts: SessionEvidenceCounts
  readonly reason: SessionEndReason
}

export type SessionTraceEvent =
  | EvidenceAcceptedEvent
  | EvidenceAnsweredEvent
  | EvidenceBroadcastEvent
  | SessionEvidenceEndEvent

/**
 * The Session a store-or-view record joins on. Both are absent only where
 * there was no Session to name — an evidence pull answered `no_session`.
 */
export interface SessionTraceIdentity {
  readonly sessionId?: SessionId
  readonly generation?: SessionGeneration
}

/** What a store-or-view decision hands the writer: the event and the Session it happened in. */
export type SessionTraceEntry = SessionTraceIdentity & SessionTraceEvent

/** One line of a trace file written outside a Run. */
export type SessionTraceRecord = SessionTraceEntry & {
  readonly v: number
  /** Wall-clock epoch ms when the record was written. */
  readonly at: number
}

/** One line of a trace file, whoever wrote it. */
export type TraceRecord = RunTraceRecord | SessionTraceRecord

export interface RunTraceSink {
  write(record: TraceRecord): void
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

/**
 * What a store or view decision calls to trace itself; absent when nothing
 * is tracing. Same guard as the Run writer: building the record happens
 * inside it, so no diagnosis can break the decision it records.
 */
export type SessionTraceWriter = (entry: () => SessionTraceEntry) => void

/**
 * Binds a sink to the Session-scoped records. These are written by main —
 * the store's own acceptance, the IPC answer, the broadcast, the end — so
 * there is no Run identity to bind up front; each entry names the Session
 * it saw at the moment it happened, and a pull with no Session names none.
 */
export function createSessionTraceWriter(deps: { sink: RunTraceSink; now(): number }): SessionTraceWriter {
  return (entry) => {
    try {
      deps.sink.write({ v: RUN_TRACE_VERSION, at: deps.now(), ...entry() })
    } catch {
      // A failed trace must never break the decision it is recording.
    }
  }
}
