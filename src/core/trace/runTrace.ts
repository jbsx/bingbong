// The Run Trace (#180, ADR 0031): a durable, machine-readable record of a
// Run's internal decisions, written for diagnosis only. It is never
// rendered in any view and never provides continuity to a Session — it
// lives beside the perf logs, not in Recorded History, because Session
// Evidence must never be recoverable from an always-on store. The file is
// a contract: every record carries a version and the identities that join
// it to the eval tape.
//
// None of it is written unless a developer opts in with
// `BINGBONG_RUN_TRACE` (#184): with the flag unset there is no sink, so a
// deployed Kiosk leaves no Run Trace at all. Everything a Run records
// rides that one flag — the grading records here, the reasoning records
// (#182), and a fault reported with a turn id in hand (#184).

import type { PipelineEvent } from '../pipeline/events'
import type { ObservationProducer } from '../session/observationLedger'
import type { SessionEvidenceCounts } from '../session/sessionEvidence'
import type { SessionEndReason } from '../session/sessionRuntime'
import type { RunId, SessionGeneration, SessionId } from '../session/sessionIdentity'
import type { FaultEvent } from './fault'

/** The record-shape version every line carries; bump it when a field's meaning changes. */
export const RUN_TRACE_VERSION = 1

/** How much of a graded observation's retained text a record keeps. */
export const TRACE_PAYLOAD_HEAD_CHARS = 500

/** How much of a round's reasoning a `reasoning` record keeps (#182). */
export const TRACE_REASONING_MAX_CHARS = 8_000

/**
 * How much of a `tool_result` event's text a `pipeline_event` record keeps
 * (#185). One page read is 40 KB; a 5 MB roll and a 7-day purge stop
 * meaning anything if every read is kept whole, so the result text is the
 * one field the tap cuts — with `chars` beside it, so the cut is visible.
 */
export const TRACE_TOOL_RESULT_MAX_CHARS = 8_000

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
 * The model's own reasoning for one LLM round (#182), written whenever
 * the Run is tracing at all (#184). Reasoning deltas stream to the Feed as
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
  /**
   * The delegated worker whose round thought this (#183); absent on the
   * Run's own rounds. The record still carries the parent Run's identity,
   * so a worker's thinking joins the Run that delegated it — and joins the
   * checkpoint records, which stamp the same `agentId` on the citations a
   * worker's observations grounded (#123, #180).
   */
  readonly agentId?: string
}

/**
 * One PipelineEvent as it was published (#185): the event object itself,
 * owner stamps included, under `event`. The stream is what every view —
 * the dashboard, the Feed, Recorded History, the voice session — is told,
 * so recording it verbatim records exactly what they saw: the Run Plan,
 * each Tool Round's call and result, status, errors, asks, confirmations,
 * and the Session boundaries.
 *
 * Two kinds never land here: `llm_delta` and `llm_tool_intent`, which are
 * streaming chunks whose assembled result the `reasoning` record and the
 * `display`/`done` events already carry.
 */
export interface PipelineEventTraceEvent {
  readonly kind: 'pipeline_event'
  /** The event as published — verbatim, but for a cut `tool_result` text. */
  readonly event: PipelineEvent
  /**
   * The full length of a `tool_result`'s text before the cut at
   * {@link TRACE_TOOL_RESULT_MAX_CHARS}, so a truncated record still says
   * how much result it stands for. Absent on every other kind, and on a
   * result whose value is not text.
   */
  readonly chars?: number
  /**
   * The delegated worker whose Tool Round published this (#185); absent on
   * the Run's own stream. A worker's rounds never reach the main stream —
   * only its `agent_update` cards and `subagent_finalized` do — so they are
   * tapped inside the worker and land under the parent Run's identity,
   * the pattern `reasoning` (#183) and the checkpoint records (#123) use.
   */
  readonly agentId?: string
}

/** One decision a Run traces, whatever kind it is. */
export type RunTraceEventBody = EvidenceCheckpointEvent | ReasoningEvent | PipelineEventTraceEvent

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

/**
 * One fault reported with a turn id in hand (#184). It rides the Run
 * Trace because the turn is what a diagnosis joins it on — the failure
 * belongs beside the decisions of the Run it happened in. Unlike the
 * records a Run writes through {@link createRunTraceWriter}, a fault is
 * reported from wherever it was caught, so it carries only the identities
 * the caller actually had: the turn id always, the rest when known.
 */
export type FaultRunTraceRecord = FaultEvent & {
  readonly v: number
  /** Wall-clock epoch ms when the record was written. */
  readonly at: number
  readonly turnId: string
  readonly runId?: RunId
  readonly sessionId?: SessionId
}

/**
 * One published PipelineEvent as the main-side tap recorded it (#185).
 * The tap sits at the publisher, where the history recorder attaches, so
 * it sees events the Run never bound an identity for — a Session
 * lifecycle boundary, a download announcement, a subagent card. Each
 * record therefore carries the identities the event itself was stamped
 * with, and nothing it was not: a `session_started` names its Session and
 * no turn, and that is the honest record of what was published.
 *
 * A worker's Tool Rounds take the other road — the parent Run's writer,
 * which binds the full identity — and land as {@link RunTraceRecord}s of
 * the same kind. Both shapes serialize to one line shape; only which
 * identities are present differs, and that difference is the fact.
 */
export type PipelineEventTraceRecord = PipelineEventTraceEvent & {
  readonly v: number
  /** Wall-clock epoch ms when the record was written. */
  readonly at: number
  readonly turnId?: string
  readonly runId?: RunId
  readonly sessionId?: SessionId
  readonly generation?: SessionGeneration
}

/** One line of a trace file, whoever wrote it. */
export type TraceRecord =
  | RunTraceRecord
  | SessionTraceRecord
  | FaultRunTraceRecord
  | PipelineEventTraceRecord

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
