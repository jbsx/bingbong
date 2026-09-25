import type { RunJournalSnapshot } from '../session/runJournal'
import type { FinalizationCause, RunResolution } from '../session/runJournal'
import type { MemoryEntryId, MemoryPatch, WorkingMemorySnapshot } from '../session/workingMemory'
import type { SessionEvidenceSnapshot } from '../session/sessionEvidence'
import type { RetainedUserObjective } from '../session/objectiveContinuity'
import type { InspectionSubject } from '../session/inspectionReference'
import type { UserCorrectionSubject } from '../session/userCorrections'
import type { VerificationSubject } from '../session/verificationAttempts'
import type { AnswerShape } from '../agent/answerContract'
import type { AskedItemStanding } from '../agent/askedItems'
import type { SubagentReportFinding } from '../agent/subagentReport'
import type { MishearProposal } from '../voice/learnedTerms'

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export type ToolResultOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: string }

export interface ToolResult {
  call: ToolCall
  outcome: ToolResultOutcome
}

/**
 * How hard the provider should think on one round (#166): the rungs GLM
 * exposes as `reasoning_effort`, in ascending order. A Run's rung is a
 * pure function of its Effort Epoch — RUN_PLAN_REASONING_EFFORT until its
 * first Run Plan is declared (#252), its tier's TIER_REASONING_EFFORT
 * while acquiring after that, FINALIZATION_REASONING_EFFORT once
 * Finalization begins (#215) — so deliberation is bounded by the same
 * declaration that bounds rounds and wall time. The type is derived from
 * the list so the experiment override's parser and the union cannot drift.
 */
export const REASONING_EFFORTS = ['low', 'medium', 'high', 'max'] as const
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

export interface LlmRequest {
  command: string
  toolResults: ToolResult[]
  /**
   * The rung this round runs at (#166), read from the Effort Epoch as the
   * request is built. Absent, the client sends no field and the provider's
   * own default decides — the shape scripted doubles and older clients keep.
   */
  reasoningEffort?: ReasoningEffort
  /**
   * The spoken utterance hit the 30 s hard cap (#61): the command may be
   * cut off mid-sentence. Clients flag it in-band (a note appended to the
   * command message) so the model asks the user to finish instead of
   * guessing at the truncated intent. Absent on complete commands.
   */
  truncated?: boolean
  /** A user correction captured while the current run was paused. */
  steering?: string
  /**
   * The Standing Directive (#167): the user's own words from the last
   * Steering correction, on every round after the one that carried it as
   * `steering`. The original command stays in context for the whole Run,
   * so without this the corrected objective survives only if the model
   * restates it — at a low reasoning rung it did not, and the Run finished
   * on the page the user had just corrected away from. Never sent on the
   * same round as `steering`: the two are the same words, once as the
   * arriving directive and after that as the correction still in force.
   */
  standingDirective?: string
  /**
   * The user's standing objective (#206, ADR 0039): the objective and
   * constraints the user's own words set, quoted from the User
   * Observations that grounded them and projected from the same
   * admission snapshot `memory` carries. A continuation command — "keep
   * looking" — names no task, and the model's own Run Notes and
   * Assessments are exactly the wrong place to recover one from: a
   * summary that quietly rewrote "a post I found" into "a post I
   * authored" reads as fluently as the truth. Absent when the Session
   * holds no user-set objective it can still quote.
   */
  objective?: RetainedUserObjective
  /**
   * The Candidate a previous Answer presented for inspection (#210, ADR
   * 0039): the subject "show me that again", "scroll down", or "not that
   * one" is about, resolved from the Session's retained Inspection
   * Reference. Absent when the Session holds no unambiguous subject — the
   * one case where the model asks the user which Candidate they mean,
   * since the alternative is answering about whichever page is open.
   */
  inspection?: InspectionSubject
  /**
   * The user's own words the Session retained and no Run has resolved
   * (#211, ADR 0039), oldest first. A correction is retained before its
   * Run's first model request, so these outlive a request that failed
   * before it could interpret them — and they are quoted, never
   * classified: nothing upstream has decided that any of them is a
   * rejection. Until a Run grounds one into a decision the Session
   * retains, the words outrank every older Assessment about what they
   * were spoken about. Absent when the Session holds nothing unresolved.
   */
  corrections?: readonly UserCorrectionSubject[]
  /**
   * The verification routes this objective has already spent (#212, ADR
   * 0041): what each attempt mechanically reported, in its own words,
   * and whether one fresh attempt is open — which it is only while a
   * specific eligible Candidate could be settled by one.
   *
   * A failed check is the one thing a continuing search must not repeat
   * blindly: the captured failure gathered four interchangeable
   * shortlists behind one unreadable image, each Run reporting the same
   * unverified leads because nothing recorded that the check, rather
   * than the search, was what failed. Absent when nothing has failed —
   * the ordinary case, in which every route is simply open.
   */
  verification?: VerificationSubject
  /** One immutable Session Journal snapshot, captured when this Run was accepted. */
  journal?: RunJournalSnapshot
  /** One immutable Session Working Memory snapshot captured with the Journal. */
  memory?: WorkingMemorySnapshot
  /**
   * Checkpointed Session Evidence this Run starts beside (#121, ADR 0028):
   * the immutable admission snapshot — grounded Observations earlier Runs
   * verified, so work is not repeated.
   */
  evidence?: SessionEvidenceSnapshot
  /** Turn correlation id (#28); perf spans key on it when present (#29). */
  turnId?: string
  /**
   * Retry visibility (#29, #43): a client with an internal retry loop
   * reports each attempt beyond the first — with the loop's ceiling, so
   * the dashboard can render "retrying 2/3" — before the attempt starts.
   * The reason names which loop retried (#271): an empty completion, or a
   * Transport Retry, which also hands over the rejection it repeats so the
   * abandoned attempt's record can say what failed.
   */
  onRetryAttempt?: (attempt: number, maxAttempts: number, reason: LlmRetryReason, error?: unknown) => void
  /**
   * Attempt identity (#191): a client reports each attempt it dispatches —
   * the first and every retry — with the model and prompt it is sent
   * under, before the attempt starts. The Run Trace's `llm_round` record
   * reads it; nothing else does. Absent, the client reports nothing.
   */
  onAttempt?: (sent: LlmAttemptSent) => void
  /**
   * Streaming (#47): when present, a streaming-capable client streams this
   * round and invokes the listener as SSE chunks arrive — mirroring the
   * transcriber's partial-transcript idiom (`Transcriber.onPartial`).
   * Absent, the round stays non-streaming (the scripted-double fallback
   * shape; subagent clients never pass one).
   */
  onDelta?: (delta: LlmStreamDelta) => void
  /**
   * The reserved Finalization Answer round (#136, ADR 0027): the one
   * model request after the terminal bookkeeping Tool Round is spent.
   * Sent with no tool catalog and no automatic tool choice — the model
   * boundary is asked for the final Answer contract only, so a model
   * fresh off a rejected Evidence Checkpoint cannot select
   * `record_evidence` again and trip the deterministic hard-failure
   * path. The pipeline's deterministic fallback still concludes the run
   * when this round fails, stays empty, or violates the contract.
   */
  answerOnly?: boolean
  /**
   * The Finalize Instruction this round is sent under (#207, ADR 0038):
   * the reason the run stopped, which tools are closed, and what reply is
   * wanted. Present on every Finalization request — the bookkeeping round
   * and the reserved Answer round — because a Run that stopped before it
   * executed anything has no refusal and no bookkeeping result for the
   * instruction to ride, and a model never told acquisition closed answers
   * as if it had not. Absent while the run is working.
   */
  finalizeInstruction?: string
  /**
   * The Answer Retry this request carries (#245): the Malformed Answer the
   * last round returned, which enters history as the assistant's reply, and
   * the message asking for the Answer alone, which rides as the request's
   * last user message — after the Finalize Instruction when both are
   * present. Present on the one request after a Malformed Answer, once per
   * Run or Subagent run; nothing else about that request changes.
   */
  answerRetry?: AnswerRetryRequest
  /**
   * Aborts the in-flight HTTP request immediately (#47): the pipeline
   * wires Stop to this signal so aborting a run no longer waits out the
   * request timeout. Clients that ignore it keep the old contract.
   */
  signal?: AbortSignal
}

/** What one Answer Retry sends (#245): the reply that could not be read, and the message about it. */
export interface AnswerRetryRequest {
  /** The Malformed Answer as the model wrote it. */
  readonly reply: string
  /** The Answer Retry message, built by `answerRetryMessage`. */
  readonly message: string
}

/** One streamed fragment of an orchestrator round (#47). */
export type LlmStreamDelta =
  /** Raw answer content as emitted by the provider (pre answer-contract). */
  | { kind: 'text'; text: string }
  /**
   * Reasoning trace fragment — `reasoning_content`, the de facto
   * OpenAI-compatible reasoning field. Opportunistic pass-through: absent
   * deltas simply never arrive for providers that don't emit them.
   */
  | { kind: 'reasoning'; text: string }
  /**
   * Tool-call intent (#48): the accumulated name and raw argument JSON
   * so far for the call at `index`, emitted while the arguments are still
   * streaming — before the tool executes. Lets the feed show direction
   * ("clicking 'Search'…") ahead of execution.
   */
  | { kind: 'tool_intent'; index: number; name: string; args: string }

/** Token usage as reported by the provider (absent when unknown). */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
}

/**
 * What one attempt was sent under (#191): the identity a client reports
 * through {@link LlmRequest.onAttempt} as it dispatches. The pipeline
 * never sees a model id or a system prompt — the client resolves the one
 * and builds the other — so this is how a Run Trace record can say which
 * model served a round and under which prompt text, without the request
 * text itself leaving the client.
 */
export interface LlmAttemptSent {
  /** The model id the attempt went to — `scripted` for the test double. */
  model: string
  /**
   * A stable hash of the system prompt text sent, never the text itself;
   * absent for a client that sends none. Two rounds with different hashes
   * ran under different prompts (a Learned Terms change, a date rollover).
   */
  promptHash?: string
  /**
   * The rung actually sent, when one was: the request's own unless the
   * experiment override (#166) outranked it.
   */
  reasoningEffort?: ReasoningEffort
}

export type AssistantTurn =
  | {
      kind: 'answer'
      speak: string
      display: string
      /** Hidden continuity output from the same final model response. */
      runNote?: string
      runNoteIssue?: 'malformed'
      /** Validated hidden Working Memory operations from the same final response. */
      memoryPatch?: MemoryPatch
      memoryPatchIssue?: 'malformed'
      /**
       * Validated Mishear proposals (ADR 0022) from the same final
       * response: confident repairs plus removals of bad Learned Terms.
       * Malformed drops the whole list — the Answer itself stands.
       */
      mishearProposals?: readonly MishearProposal[]
      mishearProposalsIssue?: 'malformed'
      /**
       * Validated Subagent Report sections (#98): findings with evidence
       * references plus unresolved items. Only subagent answers carry them;
       * an invalid or absent section simply stays absent — the prose report
       * is unaffected.
       */
      findings?: readonly SubagentReportFinding[]
      unresolved?: readonly string[]
      /**
       * Proposed Run Resolution (#110): how the Answer claims the request
       * ended semantically. Enum-validated at the contract; malformed drops
       * the field (see resolutionIssue) without touching the Answer.
       */
      resolution?: RunResolution
      resolutionIssue?: 'malformed'
      /**
       * Proposed Finalization Cause (#110): enum-validated; runtime-owned
       * causes are overridden by the pipeline's own record of how the run
       * ended, so only `objective_met` can survive as a proposal.
       */
      finalizationCause?: FinalizationCause
      finalizationCauseIssue?: 'malformed'
      /**
       * The supporting Session Evidence identities (#122, ADR 0028):
       * the Memory Entry ids of the Observations this Answer's claims —
       * and any Assessments in the Memory Patch — stand on. Validated at
       * the contract; malformed drops the list without touching the
       * Answer.
       */
      evidenceIds?: readonly MemoryEntryId[]
      evidenceIssue?: 'malformed'
      /**
       * The Candidate this Answer presents for inspection (#210, ADR
       * 0039): one existing Candidate identity, so a later "show me that
       * again" addresses what was presented rather than whatever page
       * the Run left open. The relationship is retained only when this
       * Answer is actually presented, and only when the identity names a
       * live Candidate — an unpresented draft establishes nothing.
       */
      inspectionCandidateId?: MemoryEntryId
      inspectionIssue?: 'malformed'
      /**
       * The Asked Item standings (#250, ADR 0052): one entry per Asked
       * Item the Run Plan declared, `stated` with the statement or
       * `unverified` with why. Validated at the contract; malformed drops
       * the list, which the pipeline then reads as missing.
       */
      askedItems?: readonly AskedItemStanding[]
      askedItemsIssue?: 'malformed'
      /**
       * Which contract the reply matched (#198, ADR 0034): the parser's
       * own marker, so neither loop judges prose itself. Optional here,
       * required on `parseAssistantAnswer`'s result — which is where the
       * guarantee belongs, because the wire client builds every real
       * answer turn by spreading that result and so can never omit it.
       * Absent means a client said nothing, and the two reserved rounds
       * read only an explicit `off_contract` as a failed round: a double
       * that scripts a turn by hand keeps the ordinary behaviour rather
       * than being forced to answer a question it has no view on.
       */
      shape?: AnswerShape
      /** What could not be read (#245), the parser's own words; present with a `malformed` shape. */
      malformedError?: string
      usage?: TokenUsage
    }
  | { kind: 'tool_calls'; calls: ToolCall[]; usage?: TokenUsage }

export interface LlmClient {
  complete(request: LlmRequest): Promise<AssistantTurn>
}

/**
 * The client's own request timeout ended the round (#218): the provider
 * had not finished answering when the client gave up waiting. Thrown as
 * its own class so the round's record can name it — a round that was
 * still reasoning when the client cut it is not an empty completion,
 * and reading the two alike is how #218's captures were first
 * misdiagnosed. A caller's own abort (Stop, the deadline) is not this:
 * the client rethrows that as it came.
 */
export class LlmRequestTimeoutError extends Error {
  readonly timeoutMs: number
  constructor(timeoutMs: number, options?: ErrorOptions) {
    super(`orchestrator request timed out after ${timeoutMs} ms`, options)
    this.name = 'LlmRequestTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

/**
 * Why a client repeated an attempt within one round (#271): the provider
 * answered empty, or the request was a Transport Failure.
 */
export type LlmRetryReason = 'empty' | 'transport'

/**
 * A Transport Failure (#271, ADR 0066): the request ended with no
 * response from the provider at all — the fetch call itself rejected, the
 * connection never made or lost before the first byte — and the Transport
 * Retry rejected too. Neither the provider answering with an error status
 * nor a stream breaking after its first token is this, and neither is the
 * client's own timeout or the caller's abort. `code` is the transport's
 * own name for what happened (undici's `ECONNRESET`,
 * `UND_ERR_CONNECT_TIMEOUT`) when the rejection carried one; `cause` is
 * the last rejection itself.
 */
export class LlmTransportError extends Error {
  readonly code?: string
  readonly attempts: number
  constructor(attempts: number, options: { cause: unknown }) {
    const code = transportErrorCode(options.cause)
    super(`orchestrator request failed at the transport after ${attempts} attempts: ${transportErrorMessage(options.cause)}${code !== undefined ? ` (${code})` : ''}`, options)
    this.name = 'LlmTransportError'
    this.attempts = attempts
    if (code !== undefined) this.code = code
  }
}

/** The transport's own code for a rejection: the error's, else its cause's (undici nests it one deep). */
export function transportErrorCode(error: unknown): string | undefined {
  const own = codeOf(error)
  if (own !== undefined) return own
  return error instanceof Error ? codeOf(error.cause) : undefined
}

function codeOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('code' in value)) return undefined
  const code = (value as { code: unknown }).code
  return typeof code === 'string' && code.length > 0 ? code : undefined
}

function transportErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Every attempt of the round came back with neither content nor a tool
 * call (#218): the provider answered, and said nothing. Thrown as its
 * own class for the same reason as the timeout — the round's record
 * distinguishes a provider that answered empty from one that was cut.
 */
export class LlmEmptyCompletionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmEmptyCompletionError'
  }
}
