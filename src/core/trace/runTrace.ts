// The Run Trace (#180, ADR 0031): a durable, machine-readable record of a
// Run's internal decisions, written for diagnosis only. It is never
// rendered in any view and never provides continuity to a Session — it
// lives beside the perf logs, behind a flag, because Session Evidence
// must never be recoverable from an always-on store. The file is
// a contract: every record carries a version and the identities that join
// it to the eval tape.
//
// None of it is written unless a developer opts in with
// `BINGBONG_RUN_TRACE` (#184): with the flag unset there is no sink, so a
// deployed Kiosk leaves no Run Trace at all. Everything a Run records
// rides that one flag — the grading records here, the reasoning records
// (#182), and a fault reported with a turn id in hand (#184).

import type { PipelineEvent } from '../pipeline/events'
import type { IdentitySlip } from '../pipeline/answerEvidence'
import type { SearchSignature } from '../pipeline/searchLoopRail'
import type { NotFoundLanding } from '../browser/notFoundPage'
import type { UnavailableLanding } from '../browser/unavailablePage'
import type { ComposedAddressRewriteStamp } from '../pipeline/composedAddressRail'
import type { TierEscalationDecline } from '../pipeline/effortEpoch'
import type { UnseenPhraseRewriteStamp } from '../pipeline/unseenPhraseRail'
import type { AnswerShape } from '../agent/answerContract'
import type { AgentRole } from '../agent/modelRouting'
import type { ReasoningEffort, TokenUsage } from '../ports/llm'
import type { ObservationProducer } from '../session/observationLedger'
import type { FinalizationCause } from '../session/runJournal'
import type { SessionEvidenceCounts } from '../session/sessionEvidence'
import type { SessionEndReason } from '../session/sessionRuntime'
import type { RunId, SessionGeneration, SessionId } from '../session/sessionIdentity'
import type { FaultEvent } from './fault'
import type { VisionRunTraceRecord } from './visionTrace'

/**
 * The record-shape version every line carries; bump it when a field's
 * meaning changes, or when a record's absence starts to mean something.
 * 2 (#246): an Answer with no `identity_slip` record had no Identity Slip,
 * which a version-1 trace cannot say.
 * 3 (#256): a Finalization entry with no `finalization_entry` record never
 * reached its bookkeeping decision, which a version-2 trace cannot say.
 * 4 (#256, ADR 0057): an `llm_round` with no `firstTokenMs` streamed
 * nothing before it ended, which a version-3 trace cannot say.
 * 5 (#266, ADR 0063): a budget or deadline `finalization_entry` with no
 * `declined` field was not a refused Tier Escalation, which a version-4
 * trace cannot say.
 */
export const RUN_TRACE_VERSION = 5

/** How much of a graded observation's retained text a record keeps. */
export const TRACE_PAYLOAD_HEAD_CHARS = 500

/** How much of a round's reasoning a `reasoning` record keeps (#182). */
export const TRACE_REASONING_MAX_CHARS = 8_000

/**
 * How much of an off-contract reserved reply an `off_contract_reply`
 * record keeps (#198). A reserved round has no tools and one job, so its
 * reply is short; the cut exists so a model that dumps a page into the
 * round cannot dominate the roll, and `chars` beside it keeps the cut
 * visible.
 */
export const TRACE_OFF_CONTRACT_TEXT_MAX_CHARS = 4_000

/**
 * How much of a `tool_result` event's text a `pipeline_event` record keeps
 * (#185). A 5 MB roll and a 7-day purge stop meaning anything if every
 * result is kept whole, so the result text is the one field the tap cuts
 * — with `chars` beside it, so the cut is visible. The page-read tools in
 * {@link TRACE_WHOLE_RESULT_TOOLS} are exempt (#191).
 */
export const TRACE_TOOL_RESULT_MAX_CHARS = 8_000

/**
 * The tools whose result a `pipeline_event` record keeps whole (#191): a
 * `read_page` snapshot is ~40 KB and the ref the model clicked is usually
 * past the 8 000-char cut, which made the one record a browser post mortem
 * reads most the one it could not read. Twenty reads are ~800 KB against
 * the roll, which the purge already bounds; if the roll proves too small
 * the answer is a bigger roll for the family, never a cut snapshot.
 * `ground_visual` is listed because the issue names it; its result today
 * is one "use ref N" line, so the exemption costs nothing and holds if it
 * ever returns the snapshot it grounded against.
 */
export const TRACE_WHOLE_RESULT_TOOLS: ReadonlySet<string> = new Set(['read_page', 'ground_visual'])

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
 * verdict. The Feed shows only the display line and the error text;
 * this is where a rejected or vanished checkpoint is diagnosed.
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
  /**
   * On success, whether the store merged the checkpoint into an exact
   * duplicate it already held (#240, ADR 0051). Absent on rejections and in
   * traces written before the field existed.
   */
  readonly merged?: boolean
  /** The delegated worker whose observations graded a subagent citation (#123). */
  readonly agentId?: string
  /**
   * On an acceptance of a mis-shaped call (#253, ADR 0054), the Notice that
   * told the model the canonical shape. The outcome still reads 'accepted'.
   */
  readonly correction?: string
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

/** Which loop sent a round: the Run's own, or a delegated worker's (#191). */
export type LlmRoundRole = 'orchestrator' | 'subagent'

/** The request's shape as counts, never its text (#191). */
export interface LlmRequestShape {
  /** How many assistant/tool pairs the round carried — the Run's context depth. */
  readonly toolResults: number
  /** The request's content in characters: command, tool results, directives, continuity. */
  readonly chars: number
}

/**
 * How one LLM attempt ended (#218): `completed` returned a turn; `deadline`
 * was cut by the Run's active-work deadline and `allowance` by its
 * Finalization Allowance; `timeout` by the client's own request timeout;
 * `empty` came back with neither content nor a tool call; `cancelled` was
 * aborted by a Stop; `failed` threw anything else. A cut round is never
 * an empty one, however alike the two look from the outside — reading
 * them alike is how a Session's decay was first misdiagnosed — and a
 * per-round latency reads only `completed` rounds.
 */
export type LlmRoundOutcome = 'completed' | 'deadline' | 'allowance' | 'timeout' | 'empty' | 'cancelled' | 'failed'

/**
 * One LLM attempt as it was sent (#191): the record that answers "why did
 * the model choose what it chose" alongside `reasoning`. The `command`,
 * `tool_call` and `tool_result` records already hold the request's text,
 * so this holds only what they cannot: which model served the attempt,
 * under which prompt, at which rung, how big the request was, and what
 * it cost — the numbers a "ran out of rounds" post mortem reads round by
 * round. Numbered exactly as the `reasoning` record for the same attempt,
 * so the two join on `round` and `attempt`.
 */
export interface LlmRoundEvent {
  readonly kind: 'llm_round'
  /** Which LLM round of the Run, counting from 1 — the `reasoning` record's numbering. */
  readonly round: number
  /** Which attempt within that round, counting from 1 — the `reasoning` record's numbering. */
  readonly attempt: number
  readonly role: LlmRoundRole
  /** How the attempt ended (#218). */
  readonly outcome: LlmRoundOutcome
  /**
   * How many characters of reasoning the attempt streamed before it
   * ended (#218) — the full length, where the `reasoning` record's text
   * is cut. Zero for a round that streamed no reasoning, including one
   * that never streamed at all.
   */
  readonly reasoningChars: number
  /**
   * How long the attempt waited for its first streamed fragment (#256, ADR
   * 0057), reasoning or content or a tool intent, from the moment the
   * client reported dispatching it. Absent when nothing streamed before
   * the attempt ended — a cut before the first token, a non-streaming
   * round, or a client that reported no dispatch — so a cut round's
   * record says whether the provider had started answering.
   */
  readonly firstTokenMs?: number
  /** The model the attempt went to; absent when the client reported none (it threw before dispatch). */
  readonly model?: string
  /** The rung sent: the client's word when it reported one, else the request's. */
  readonly reasoningEffort?: ReasoningEffort
  /** Token usage, when the provider reported it — only an attempt that returned has one. */
  readonly usage?: TokenUsage
  /** A stable hash of the system prompt text sent, never the text. */
  readonly promptHash?: string
  readonly request: LlmRequestShape
  /** The delegated worker whose round this was (#183); absent on the Run's own rounds. */
  readonly agentId?: string
}

/**
 * One reserved Answer round whose reply was off contract (#198, ADR 0034):
 * prose, or JSON of the wrong shape, where the round's one job was an
 * Answer or a Subagent Report. The round failed — the Run's deterministic
 * Answer or the worker's bounded report stood in — so the model's own
 * words reach no view and no Recorded History, and this record is the only
 * place they are kept. It joins the round's `reasoning` and `llm_round`
 * records through the turn and, for a worker, the `agentId`.
 */
export interface OffContractReplyEvent {
  readonly kind: 'off_contract_reply'
  /** Which loop's reserved round it was: the Run's own, or a delegated worker's. */
  readonly role: LlmRoundRole
  /**
   * The parser's shape marker, carried verbatim: `off_contract` for prose,
   * `malformed` for a reply that carried the contract's keys but not its
   * shape (#245). The cut belongs to the parser, which is why a finer
   * marker widened this record rather than adding a kind.
   */
  readonly shape: AnswerShape
  /** The reply as the model wrote it, cut at {@link TRACE_OFF_CONTRACT_TEXT_MAX_CHARS}. */
  readonly text: string
  /** Full length in characters before the cut, so truncation is visible. */
  readonly chars: number
  /** The Finalization Cause the stand-in Answer or bounded report was built with. */
  readonly cause: FinalizationCause
  /** The delegated worker whose round replied (#183's stamp); absent on the Run's own. */
  readonly agentId?: string
}

/**
 * One Malformed Answer (#245): a reply outside a reserved round that carried
 * the Answer contract's keys but that no candidate read as its shape. Written
 * at detection, beside a fault, whether or not the Answer Retry is still
 * unspent — the `answer_retry` record says whether one followed.
 */
export interface MalformedAnswerEvent {
  readonly kind: 'malformed_answer'
  readonly role: LlmRoundRole
  /** The reply as the model wrote it, cut at {@link TRACE_OFF_CONTRACT_TEXT_MAX_CHARS}. */
  readonly text: string
  /** Full length in characters before the cut. */
  readonly chars: number
  /** What could not be read: the parser's message with its position, or the field and what it was. */
  readonly error: string
  /** The delegated Subagent whose round replied; absent on the Run's own. */
  readonly agentId?: string
}

/**
 * How the round that carried an Answer Retry resolved (#245): an Answer on
 * contract, another Malformed Answer, a prose Answer, a Tool Round, or a
 * round that returned no turn.
 */
export type AnswerRetryOutcome = 'on_contract' | 'malformed' | 'prose' | 'tool_calls' | 'round_failed'

/** One Answer Retry, written when the round that carried it resolves (#245). */
export interface AnswerRetryEvent {
  readonly kind: 'answer_retry'
  readonly role: LlmRoundRole
  readonly outcome: AnswerRetryOutcome
  /** The delegated Subagent that retried; absent on the Run's own. */
  readonly agentId?: string
}

/** Which model each role was routed to when the Run declared its plan (#191). */
export type RunPlanModels = Partial<Record<AgentRole, string>>

/**
 * A capture of the visible tab at a failed finalization (#191): the one
 * record whose payload is not in the file. The PNG is a sibling file
 * beside the jsonl, named after the Run and turn and purged under the
 * same 7-day rule; the record names it. Written only for a `done` that
 * finalized failed or on a work rail — the rounds a post mortem reads.
 */
export interface FailureScreenshotEvent {
  readonly kind: 'failure_screenshot'
  /** `failed`, or the rail's Finalization Cause that made the Run end. */
  readonly cause: FailureScreenshotCause
  /** The PNG's absolute path. */
  readonly path: string
  readonly bytes: number
}

/**
 * The Finalization Causes that earn a screenshot (#191): the rails a post
 * mortem reads. `blocker` is the case the screenshot answers outright
 * (#202) — what the wall actually looked like when the run kept at it.
 */
export const FAILURE_SCREENSHOT_RAIL_CAUSES = ['no_progress', 'deadline_reached', 'budget_exhausted', 'blocker'] as const

/** What earns a failure screenshot: a failed outcome, or a finalization on one of those rails. */
export type FailureScreenshotCause = 'failed' | (typeof FAILURE_SCREENSHOT_RAIL_CAUSES)[number]

/**
 * One PipelineEvent as it was published (#185): the event object itself,
 * owner stamps included, under `event`. The stream is what every view —
 * the dashboard, the Feed, the panel overlay, the voice session — is
 * told, so recording it verbatim records exactly what they saw: the Run Plan,
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
   * Which model each role was routed to, stamped on a `run_plan` record
   * only (#191) — read from the routing config as the plan is published,
   * so runs across a model switch are told apart from the file without
   * joining every round. Absent on every other event.
   */
  readonly models?: RunPlanModels
  /**
   * The Not-found Landing a `tool_result` settled on (#239, ADR 0050): what
   * said the page names nothing, and its host — read off the whole result
   * before the cut, the way the model read it, so a record never has to be
   * parsed from truncated text. Absent on every other result and kind.
   */
  readonly notFound?: NotFoundLanding
  /**
   * The Unavailable Landing a `tool_result` settled on (#262, ADR 0060): the
   * 5xx status or the title that said the site could not serve the page, and
   * its host — read like `notFound`, of which it is the sibling. Absent on
   * every other result and kind.
   */
  readonly unavailable?: UnavailableLanding
  /**
   * The Composed Address rewrite a `tool_result` opens with (#255, ADR 0055):
   * the site whose allowance was spent and the search that ran in place of
   * the address the model composed — the `tool_call` beside it keeps the
   * address. Absent on every other result and kind.
   */
  readonly rewritten?: ComposedAddressRewriteStamp
  /**
   * The Unseen Phrase rewrite a `tool_result` opens with (#267, ADR 0064):
   * the quoted spans the Run was never shown and the terms that ran unquoted
   * — the `tool_call` beside it keeps the terms as written. Absent on every
   * other result and kind.
   */
  readonly unquoted?: UnseenPhraseRewriteStamp
  /**
   * The delegated worker whose Tool Round published this (#185); absent on
   * the Run's own stream. A worker's rounds never reach the main stream —
   * only its `agent_update` cards and `subagent_finalized` do — so they are
   * tapped inside the worker and land under the parent Run's identity,
   * the pattern `reasoning` (#183) and the checkpoint records (#123) use.
   */
  readonly agentId?: string
}

/**
 * One Search Observation (#243, ADR 0049): what the Search Loop rail saw in
 * one call it classified as a search — the query as it read it, the
 * signature, and the streak the call left, refused and failed searches
 * included. The rail decided it; the Tool Round records it beside the
 * call's tool result through the tool context's routed seam, as it records
 * a Vision Budget grant, so the record carries the turn but not the Run's
 * other ids. The Round Audit reads it in place of replaying the rule.
 */
export interface SearchObservationEvent {
  readonly kind: 'search_observation'
  /** The observed call; joins the call's `tool_call` and `tool_result` records. */
  readonly callId: string
  readonly name: string
  /** The decoded `q=` of a navigate, or the typed text of a type — exactly what the rail compared. */
  readonly query: string
  readonly signature: SearchSignature
  /** The streak after the call. */
  readonly streak: number
  /** The Browse Subagent whose rail observed it; absent on the Run's own. */
  readonly agentId?: string
}

/**
 * One Answer whose Card or Spoken Rendering carried an Identity Slip
 * (#246, ADR 0028): the internal ids the model wrote where the user reads
 * or hears, and what the display boundary did with each. The published
 * `display` and `speak` events carry the repaired text and the raw Answer
 * is kept nowhere, so this is the only record that a repair happened. Not
 * a fault — no code failed — and not an `off_contract_reply` — the reply's
 * shape was fine. Written once per slipped Answer; an Answer with no slip
 * writes none.
 */
export interface IdentitySlipEvent {
  readonly kind: 'identity_slip'
  /** One entry per slipped id, the Card's first, each in the order written. */
  readonly slips: readonly IdentitySlip[]
}

/**
 * An Answer whose `asked_items` was not the declared list (#250, ADR
 * 0052): the declared items it left without a standing and the entries
 * naming items never declared, and whether the one Answer Retry was
 * spent on it. Written at detection, in the orchestrator loop only —
 * Subagents declare no Asked Items.
 */
export interface AskedItemsShapeEvent {
  readonly kind: 'asked_items_shape'
  readonly missing: readonly string[]
  readonly undeclared: readonly string[]
  readonly retried: boolean
}

/**
 * Whether a Finalization entry kept its bookkeeping Tool Round (#256, ADR
 * 0056), and why. Written once per entry that reaches the decision — at the
 * loop top after the Report Grace, in the orchestrator loop only, since a
 * Browse Subagent's Finalization never skips. The audit counts the skips.
 */
export interface FinalizationEntryEvent {
  readonly kind: 'finalization_entry'
  /** The Finalization Cause the entry was made under. */
  readonly cause: FinalizationCause
  readonly bookkeeping: 'kept' | 'skipped'
  readonly reason: string
  /**
   * Why no Tier Escalation followed a `budget_exhausted` or
   * `deadline_reached` entry (#266, ADR 0063): the arm that was reached
   * and the first guard that refused it. Absent on every other cause, and
   * on a trace written before version 5, which could not say.
   */
  readonly declined?: TierEscalationDecline
}

/** One decision a Run traces, whatever kind it is. */
export type RunTraceEventBody =
  | FinalizationEntryEvent
  | EvidenceCheckpointEvent
  | ReasoningEvent
  | PipelineEventTraceEvent
  | LlmRoundEvent
  | OffContractReplyEvent
  | MalformedAnswerEvent
  | AnswerRetryEvent
  | FailureScreenshotEvent
  | SearchObservationEvent
  | IdentitySlipEvent
  | AskedItemsShapeEvent

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
  | VisionRunTraceRecord

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
    // eslint-disable-next-line no-restricted-syntax -- a trace writer's own guard: reporting here would re-enter the write that failed
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
    // eslint-disable-next-line no-restricted-syntax -- a trace writer's own guard: reporting here would re-enter the write that failed
    } catch {
      // A failed trace must never break the decision it is recording.
    }
  }
}
