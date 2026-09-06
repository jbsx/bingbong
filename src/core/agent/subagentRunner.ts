import type { Clock } from '../ports/clock'
import { systemClock } from '../ports/clock'
import type {
  AssistantTurn,
  LlmAttemptSent,
  LlmClient,
  LlmRequest,
  LlmStreamDelta,
  TokenUsage,
  ToolResult,
  ToolResultOutcome,
} from '../ports/llm'
import type { Tool, ToolContext } from '../pipeline/tool'
import type { SettledPageState } from '../pipeline/progressFingerprints'
import type { SnapshotRef } from '../browser/snapshot'
import type { WorkingMemorySnapshot } from '../session/workingMemory'
import type { ObservationRecord } from '../session/observationLedger'
import { createObservationLedger } from '../session/observationLedger'
import { ASK_ESCALATION_PREFIX } from '../pipeline/askUserTools'
import { subagentBlockerEscalation } from '../pipeline/blockerGate'
import { BLOCKER_HELP_BY_SIGNAL } from '../browser/blockerNudge'
import {
  blockerFinalizationReason,
  createEffortEpoch,
  NO_PROGRESS_FINALIZATION_REASON,
  type FinalizationDetail,
} from '../pipeline/effortEpoch'
import { createNotices } from '../pipeline/notices'
import type { RunDecisions } from '../pipeline/decisions'
import type { RunInterrupts } from '../pipeline/interrupts'
import { createToolRoundExecutor, unknownToolError, type FinalizationWording } from '../pipeline/toolRound'
import type { FinalizationCause } from '../session/runJournal'
import { describeToolAction } from '../pipeline/toolCallDisplay'
import { MAX_SUBAGENT_VISION_CALLS } from './subagentRails'
import { droppedFindingsNote, validateReportFindings, type SubagentReport } from './subagentReport'
import { createReasoningRounds, type ReasoningRound, type SubagentReasoningTrace } from '../trace/reasoningTrace'
import { createLlmRounds, llmRequestShape, type LlmRound, type SubagentLlmRoundTrace } from '../trace/llmRoundTrace'
import { answerText } from './answerContract'
import { recordOffContractReply, type SubagentOffContractReplyTrace } from '../trace/offContractReplyTrace'
import type { SubagentPipelineEventTrace } from '../trace/pipelineEventTrace'
import type { VisionTraceReporter } from '../trace/visionTrace'
import { reportFault } from '../trace/fault'

// The subagent workhorse loop (issue #13): one LLM (deepseek-chat via the
// model router) driving its own tool set until it produces a final report.
// No confirmations flow here (subagents cannot ask — the policy wrapper
// already downgraded confirm verdicts to denials); cancellation is polled at
// every checkpoint so a voice "stop" lands within one tool call. The report
// is structured (#98): the prose answer plus validated findings and
// unresolved items. Delegated Memory Entries (#98) ride every model round
// as untrusted data — the worker reads them, never writes them.
//
// The round itself is not this module's (#158, issue #154 step 3): a Tool
// Round is one implementation with two adapters, and this is the second.
// The worker constructs the Tool Round executor in Subagent configuration —
// its own Observation ledger and Notices, the Subagent Blocker escalation
// (the ASK_USER relay), a decisions adapter that refuses every Confirmation
// and cannot ask, interrupts that only poll cancellation, the ASK_USER
// relay as its terminal result, the Subagent vision budget, and — from
// #159 — all three capability flags on, so the worker's round runs the
// Run's search-loop rail, its no-progress rails, and its per-call deadline
// gate — and drains its generator. What stays the worker's own is what has
// no counterpart in a Run: the reserved Answer round, the deterministic
// bounded report, and the escalation early return.
//
// The rails need what they observe (#159): the worker's own tab is the
// page they judge, so `settledPageState` and `describeRef` come in beside
// `currentHost` and `currentPageUrl`. Without them the rails are inert by
// construction — the no-progress rails never judge an action they cannot
// observe, and a typed search box query cannot be classified — which is
// how a background worker with no tab keeps running unrailed.
//
// Two things converge on the shared gate chain rather than staying as the
// worker wrote them, and both are refusals either way: an `assessRisk`
// that throws now fails closed to a Confirmation — refused, in the wording
// below — instead of surfacing its own error, and the ASK_USER relay is
// recorded in the worker's Observation ledger before it ends the round
// (an escalation report carries no findings, so nothing grounds against
// it). Everything the eval corpus measures is untouched.
//
// The loop is bounded by the Effort Epoch in Subagent configuration (#149,
// ADR 0027): 12 Tool Rounds of its own plus the parent Run's shared
// active-work deadline, decided by the same module the orchestrator runs
// on and reported in the same Finalization Cause vocabulary. Exhaustion
// never throws — the worker enters its own Finalization: one reserved
// Answer-only model round, and a deterministic bounded report if that
// round fails or demands tools. A worker always terminates with a report,
// never a raw round-limit failure.
//
// The parent Run's Finalization no longer cancels this loop (#199, ADR
// 0035): it is told instead. `isParentFinalizing` is polled beside the
// shared deadline, so the worker enters its own Finalization with
// `parent_finalized` — in-flight call settles, remaining acquisition
// siblings refused, reserved report round runs — and the parent waits a
// Report Grace for the report. `abandonReport` is that grace ending: the
// round in flight is aborted and the bounded report is returned, because
// a worker the grace outran completed, and `cancelled` stays reserved
// for a decision — the user's Stop, the orchestrator's cancel, a
// Session Reset.
//
// Every report carries why the worker stopped (#162): the Finalization
// Cause rides the report beside the Observations, as hidden provenance the
// orchestrator's model never reads — `model_answered` for a voluntary
// conclusion, the epoch's mechanical cause when a rail forced Finalization
// (that cause wins over the model's own conclusion, the same precedence a
// Run's `finalizeRun` applies), and `user_unavailable` for the ASK_USER
// relay, which stops because only the user can unblock it. Without it a
// corpus pass cannot tell a worker that was cut short from one that
// finished cleanly.
//
// A worker's Tool Rounds leave their events behind on the same terms
// (#185): every event a round yields — its `tool_call`s, its
// `tool_result`s, and whatever the decision seams yield — goes to a
// `tracePipelineEvent` closure the spawning Run built, or nowhere. The
// main stream never sees them: a worker publishes only its card updates
// and its `subagent_finalized`.
//
// A worker's rounds leave their reasoning behind too (#183, ADR 0030),
// but only when the developer opted in: the spawning Run hands down a
// `traceReasoning` closure over its own trace writer, and with nothing
// handed down nothing is collected. Its presence is also what makes a
// worker's rounds stream at all — the worker path has never streamed,
// because reasoning is the only thing here that lives in the stream.
//
// The worker keeps its own Observation ledger (#123, ADR 0028): every tool
// outcome is recorded with the source URL it observed, the report's
// findings are validated against it before the report completes, and the
// records ride the report as hidden provenance for the orchestrator's
// Evidence Checkpoint. Workers never checkpoint Session Evidence
// themselves — only the orchestrator does.

export interface SubagentProgress {
  /** 1-based step number within this agent's run. */
  step: number
  /** Compact human-readable action line (shared with the transcript). */
  action: string
}

export interface RunSubagentDeps {
  llm: LlmClient
  tools: Tool[]
  clock?: Clock
  /** Lower than the orchestrator's — workhorses stay on a leash. */
  maxToolRounds?: number
  /**
   * The host this agent's own tab is on (browse kinds); the same-wall
   * Blocker gate (#81) classifies non-navigate browser calls by it.
   * Absent — like a background subagent with no tab — the gate only
   * matches navigate calls it can classify by URL.
   */
  currentHost?(): string | null
  /**
   * The URL of the page this agent's own tab is on (#123): the source
   * URL recorded on the worker's page-facing Observations — what its
   * report's findings ground against. Absent, worker observations carry
   * no source URL (grounding then refuses, like the orchestrator's).
   */
  currentPageUrl?(): string | null
  /**
   * The settled state of this agent's own tab (#159): what the
   * no-progress rails compare an action against. Absent — a background
   * worker with no tab — the rails observe nothing and stay inert.
   */
  settledPageState?(): Promise<SettledPageState | null> | SettledPageState | null
  /**
   * Snapshot ref facts for this agent's own tab (#159): how the
   * search-loop rail recognizes text typed into a search input. Absent,
   * only q= navigations count as searches.
   */
  describeRef?(ref: number): Promise<SnapshotRef | undefined>
}

export interface RunSubagentOptions {
  task: string
  /**
   * The orchestrator turn that spawned this agent (#29): stamped on every
   * model round so a perf-wrapped client keys its spans to that turn.
   */
  turnId?: string
  /**
   * This agent's own id: stamped on the report so it carries its producer's
   * provenance into agent_results and, from there, into committed memory.
   */
  agentId?: string
  /**
   * The Memory Entries delegation selected for this task (#98) — a frozen
   * slice of the spawning Run's Working Memory snapshot. Rides every model
   * round in the request's untrusted-data slot; the loop never mutates it.
   */
  memory?: WorkingMemorySnapshot
  /** Polled before each model call and each tool call. */
  isCancelled(): boolean
  /**
   * The parent Run's shared active-work deadline (#120): true once the
   * spawning Run's active-work time has passed its tier deadline. The
   * worker stops acquiring and finalizes — a bounded report, never a crash.
   */
  isWorkExpired?(): boolean
  /**
   * Whether the parent Run has entered Finalization (#199, ADR 0035):
   * polled beside the shared deadline. True, this worker enters its own
   * Finalization with `parent_finalized` — its in-flight call settles,
   * the round's remaining acquisition siblings are refused, and its
   * reserved report round runs. Finalization never cancels a worker.
   */
  isParentFinalizing?(): boolean
  /**
   * The Report Grace's end (#199, ADR 0035): aborted by the parent Run
   * when the grace elapses with this worker still running. Whatever round
   * is in flight is abandoned and the bounded report stands — a worker
   * the grace passed by completed, it was not cancelled.
   */
  abandonReport?: AbortSignal
  /** Resolves immediately while running, or after the shared pause gate opens. */
  waitIfPaused?(): Promise<void>
  onProgress?(progress: SubagentProgress): void
  /**
   * The reasoning records for this worker's rounds (#183, ADR 0031):
   * built by the spawning Run over its own Run Trace writer, so each
   * record carries the parent Run's correlation keys and this worker's
   * `agentId`. Absent unless the developer set `BINGBONG_RUN_TRACE` (#184)
   * — and with it absent the worker collects no reasoning and does not
   * stream, which is the path's historical behaviour.
   */
  traceReasoning?: SubagentReasoningTrace
  /**
   * The llm_round records for this worker's attempts (#191, ADR 0031):
   * built by the spawning Run over its own writer, like the reasoning
   * trace — one record per attempt, numbered as the reasoning records
   * are, carrying the model and prompt the client reported, the rung,
   * the request's shape and the usage. Absent unless the developer set
   * `BINGBONG_RUN_TRACE` (#184); absent, nothing is counted.
   */
  traceLlmRound?: SubagentLlmRoundTrace
  /**
   * The off_contract_reply record for this worker's reserved report round
   * (#198, ADR 0034): built by the spawning Run over its own writer, like
   * the traces beside it. A reserved round that narrates is a failed round
   * — the bounded report stands in and the worker's own words are dropped
   * — so this is the only place they are kept. Absent unless the developer
   * set `BINGBONG_RUN_TRACE` (#184); absent, the report still stands in.
   */
  traceOffContractReply?: SubagentOffContractReplyTrace
  /**
   * The pipeline_event records for this worker's Tool Rounds (#185, ADR
   * 0031): built by the spawning Run the same way, over the same writer.
   * A worker's rounds publish to nobody — only its cards and its
   * `subagent_finalized` reach the main stream — so what it called and
   * what came back is kept here or nowhere. Absent unless the developer
   * set `BINGBONG_RUN_TRACE` (#184).
   */
  tracePipelineEvent?: SubagentPipelineEventTrace
  /**
   * The vision records for this worker's Looks (#186, ADR 0031): the
   * spawning Run's reporter. The worker's own tool context carries the
   * parent's turn and this worker's `agentId`, so a delegated Look lands
   * in the Run Trace beside the Run's own rather than in the Host Trace.
   * Absent unless the developer opted in with a family.
   */
  traceVision?: VisionTraceReporter
}

export class SubagentCancelledError extends Error {
  constructor() {
    super('subagent cancelled by the user')
  }
}

// Direct loop users (tests, the CLI harness) keep the historical leash; the
// workhorse resolves the per-kind budget — browse workers get
// SUBAGENT_LIMITS.maxToolRoundsPerTask (#120), background kinds this one.
const DEFAULT_MAX_TOOL_ROUNDS = 60

/**
 * What a Confirmation verdict answers with inside a worker (#158): a
 * Subagent has no user to approve anything, so the decisions seam denies
 * every Confirmation with the wording the model has always read here.
 */
const CONFIRMATION_REFUSAL = 'subagents cannot ask the user for confirmation — skip this action and report it back'

/**
 * How Finalization reads to a worker's model (#159). The Run's own
 * wording is wrong here in three ways at once — a tripped worker's budget
 * is not spent, a worker's catalog has no Run Plan bookkeeping to fall
 * back on, and a worker finalizes into a report rather than an answer —
 * so the round's closed-tool refusal and the no-progress rail's
 * second-Approach directive both say what a worker must actually do. It
 * is the same sentence `workerFinalizationNotice` ends on, so the trip
 * round reads as one instruction rather than three contradictory ones.
 */
const WORKER_FINALIZE_INSTRUCTION =
  'The delegated work is over \u2014 browsing, vision, and ask_user tools are closed. Reply now with ONLY ' +
  'your final report JSON \u2014 state honestly what you found and what remains open.'

/**
 * And how it reads when the parent Run is what closed the work (#199,
 * ADR 0035). Nothing of the worker's own stopped it — its budget is not
 * spent and its deadline has not passed — so the sentence names the
 * parent, and ends on the same demand as every other one here.
 */
const WORKER_PARENT_FINALIZING_INSTRUCTION =
  'The parent run is finalizing. Tool calls are closed. Reply now with ONLY your final report JSON ' +
  '\u2014 state honestly what you found and what remains open.'

/**
 * And how it reads when a wall closed the work (#202, ADR 0037). The
 * worker's Blocker gate trips like the Run's, so the same reason sentence
 * the Run's model reads opens the worker's instruction — the wall is the
 * wall whoever is looking at it — and the demand stays the worker's.
 */
function workerBlockerInstruction(wall: FinalizationDetail): string {
  return `${blockerFinalizationReason(wall)}. ${WORKER_FINALIZE_INSTRUCTION}`
}

/** The instruction this Finalization's refusals and its Notice share. */
function workerFinalizeInstruction(cause: FinalizationCause | null, detail?: FinalizationDetail): string {
  if (cause === 'parent_finalized') return WORKER_PARENT_FINALIZING_INSTRUCTION
  if (cause === 'blocker' && detail !== undefined) return workerBlockerInstruction(detail)
  return WORKER_FINALIZE_INSTRUCTION
}

const workerFinalizationWording: FinalizationWording = {
  finalizeInstruction: workerFinalizeInstruction,
  approachExhausted: `A second Approach has made no progress. ${WORKER_FINALIZE_INSTRUCTION}`,
}

/**
 * The ASK_USER relay (#18): the escalation directive the Subagent's
 * ask_user tool returns. It ends the round and becomes the report verbatim
 * — the workhorse model is never trusted to carry it through another round.
 */
function askEscalation(outcome: ToolResultOutcome): string | null {
  return outcome.ok && typeof outcome.result === 'string' && outcome.result.startsWith(`${ASK_ESCALATION_PREFIX} `)
    ? outcome.result
    : null
}

/**
 * The Finalize Instruction for the worker's reserved Answer round
 * (#120): rides the last tool result the way the orchestrator's rides its
 * Finalization results — the model learns why the work stopped and that
 * only the final report JSON is accepted now. Its `no_progress` reason is
 * the Run's own constant (#201): that one stop reads identically in both
 * roles, so the two tables agree by sharing rather than by copying.
 */
// A Subagent epoch reports these five of the Finalization Causes (#159:
// `no_progress` joined the two budget causes when the worker adopted the
// Run's no-progress rails; #199: `parent_finalized` joined them when
// Finalization stopped cancelling live workers; #202: `blocker` joined
// them when keeping at a wall became a stop).
function workerFinalizationNotice(cause: FinalizationCause, maxToolRounds: number, detail?: FinalizationDetail): string {
  if (cause === 'parent_finalized') return WORKER_PARENT_FINALIZING_INSTRUCTION
  const reason =
    cause === 'deadline_reached'
      ? 'The parent run\u2019s active-work deadline has passed'
      : cause === 'no_progress'
        ? NO_PROGRESS_FINALIZATION_REASON
        : cause === 'blocker' && detail !== undefined
          ? blockerFinalizationReason(detail)
          : `Your delegated work budget (${maxToolRounds} tool rounds) is spent`
  return `${reason}. Tool calls are closed. Reply now with ONLY your final report JSON — state honestly what you found and what remains open.`
}

/**
 * How one stop cause reads in a bounded report: what the report opens on,
 * why it stopped, and what it leaves open. One cascade rather than three
 * — every cause answers all three at once, so a cause added here cannot
 * be given a lead-in and forgotten in the unresolved line.
 *
 * Only the delegated budget is a spent limit. The no-progress stop (#159)
 * had budget left and stopped because repetition stopped paying, and the
 * Blocker stop (#202) names the wall — the orchestrator reading this
 * report is the one that can ask the user about it — so neither borrows
 * the budget wording.
 */
interface BoundedStopWording {
  readonly leadIn: string
  readonly causeSentence: string
  readonly unresolved: string
}

function boundedStopWording(input: {
  cause: FinalizationCause
  detail?: FinalizationDetail
  maxToolRounds: number
}): BoundedStopWording {
  const wall = input.cause === 'blocker' ? input.detail : undefined
  if (wall !== undefined) {
    return {
      leadIn: `Stopped at a wall on ${wall.host}`,
      causeSentence: `${wall.host} is walled (Blocker: ${wall.signal}) and this task kept at it — what helps is ${BLOCKER_HELP_BY_SIGNAL[wall.signal]}`,
      unresolved: `Cut short at a wall on ${wall.host} that only the user can clear — the task is incomplete.`,
    }
  }
  switch (input.cause) {
    case 'no_progress':
      return {
        leadIn: 'Stopped without progress',
        causeSentence: 'two Approaches in a row made no progress',
        unresolved: 'Cut short with no progress left to make — the task is incomplete.',
      }
    case 'parent_finalized':
      return {
        leadIn: 'Stopped when the parent run finalized',
        causeSentence: 'the parent run finalized before this report was written',
        unresolved: 'Cut short by the parent run\u2019s finalization — the task is incomplete.',
      }
    case 'deadline_reached':
      return {
        leadIn: 'Stopped at the delegated work limit',
        causeSentence: 'the parent run reached its active-work deadline',
        unresolved: 'Cut short at the delegated work limit — the task is incomplete.',
      }
    default:
      return {
        leadIn: 'Stopped at the delegated work limit',
        causeSentence: `the delegated work budget (${input.maxToolRounds} tool rounds) was spent`,
        unresolved: 'Cut short at the delegated work limit — the task is incomplete.',
      }
  }
}

/**
 * The deterministic bounded report (#120): what the worker answers with
 * when its reserved Answer round fails or requests tools. Built only from
 * the stop cause and the run's own progress — it invents no findings.
 */
function boundedStopReport(input: {
  agentId?: string
  cause: FinalizationCause
  /** The wall a `blocker` stop kept at (#202) — the report names it, so the orchestrator can act on it. */
  detail?: FinalizationDetail
  maxToolRounds: number
  rounds: number
  lastAction: string | null
  observations?: readonly ObservationRecord[]
}): SubagentReport {
  const { leadIn, causeSentence, unresolved } = boundedStopWording(input)
  const lastActionSentence = input.lastAction !== null ? ` The last action was: ${input.lastAction}.` : ''
  return {
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
    text: `${leadIn} after ${input.rounds} tool round${input.rounds === 1 ? '' : 's'} — ${causeSentence}, and no final report was produced.${lastActionSentence}`,
    findings: [],
    unresolved: [unresolved],
    ...(input.observations !== undefined && input.observations.length > 0 ? { observations: input.observations } : {}),
    finalizationCause: input.cause,
    // Every bounded report says so (#199, ADR 0035), not only one the
    // Report Grace passed by: the stop-cause breakdown can only tell a
    // model-written report from this fallback if the fallback is marked.
    bounded: true,
  }
}

/** One model answer turn becomes the report — both exits share the mapping. */
function reportFromTurn(
  turn: Extract<AssistantTurn, { kind: 'answer' }>,
  agentId: string | undefined,
  observations: readonly ObservationRecord[],
  cause: FinalizationCause,
): SubagentReport {
  // Findings are validated before the report completes (#123, ADR 0028):
  // each must cite only sources this worker observed, or it is dropped to
  // the prose report — the orchestrator can checkpoint only grounded work.
  const validated = validateReportFindings(turn.findings ?? [], observations)
  const unresolved = [...(turn.unresolved ?? [])]
  if (validated.dropped > 0) unresolved.push(droppedFindingsNote(validated.dropped))
  return {
    ...(agentId !== undefined ? { agentId } : {}),
    text: answerText(turn),
    findings: validated.findings,
    unresolved,
    ...(observations.length > 0 ? { observations } : {}),
    finalizationCause: cause,
  }
}

async function checkpoint(options: RunSubagentOptions): Promise<void> {
  if (options.isCancelled()) throw new SubagentCancelledError()
  await options.waitIfPaused?.()
  if (options.isCancelled()) throw new SubagentCancelledError()
}

export async function runSubagent(deps: RunSubagentDeps, options: RunSubagentOptions): Promise<SubagentReport> {
  const { llm, tools } = deps
  const clock = deps.clock ?? systemClock
  const maxToolRounds = deps.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS
  // The worker's own Observation ledger (#123, ADR 0028): private Working
  // State recording what this worker actually saw, so its report's findings
  // ground against real observations and the orchestrator's Evidence
  // Checkpoint for a finding has something honest to verify against. Never
  // shown to the worker's model; dies with the loop — except for the frozen
  // snapshot that rides the completed report as hidden provenance.
  const workerLedger = createObservationLedger({
    now: () => clock.now(),
    generation: 0,
    isCurrentGeneration: () => true,
  })
  // The worker's tool context (#186): the parent Run's turn and this
  // worker's own id, so what its tools record joins the Run that
  // delegated it — the pattern the reasoning and pipeline_event records
  // already follow.
  const toolContext: ToolContext = {
    clock,
    ...(options.turnId !== undefined ? { turnId: options.turnId } : {}),
    ...(options.agentId !== undefined ? { agentId: options.agentId } : {}),
    ...(options.traceVision !== undefined ? { traceVision: options.traceVision } : {}),
  }
  const toolResults: ToolResult[] = []
  let lastAction: string | null = null
  // This Subagent's Effort Epoch (#149, ADR 0027): the Run's bounded-effort
  // module in Subagent configuration — this worker's independent Tool
  // Round budget, the parent Run's shared active-work deadline as its
  // deadline, and no Effort Tier of its own. It decides when and why
  // acquisition stops — the shared deadline ahead of the worker's own
  // remaining rounds — while the worker keeps its own loop, reserved
  // Answer round, and bounded report.
  const epoch = createEffortEpoch({
    clock,
    subagent: {
      toolRoundBudget: maxToolRounds,
      deadline: { expired: () => options.isWorkExpired?.() ?? false },
      // The parent Run's Finalization (#199, ADR 0035): polled beside the
      // shared deadline, at the loop top and before every call in a round.
      parentFinalizing: () => options.isParentFinalizing?.() ?? false,
    },
  })
  // The Report Grace's end (#199, ADR 0035): the parent waited, and this
  // worker's round — reserved or not — is abandoned where it stands. The
  // bounded report is the return, never a throw: a worker the grace
  // passed by completed, and `cancelled` is reserved for a decision.
  const graceEnded = (): boolean => options.abandonReport?.aborted === true
  const abandonedReport = (): SubagentReport =>
    boundedStopReport({
      ...(options.agentId !== undefined ? { agentId: options.agentId } : {}),
      cause: epoch.phase.kind === 'working' ? 'parent_finalized' : epoch.phase.cause,
      ...(epoch.phase.kind !== 'working' && epoch.phase.detail !== undefined ? { detail: epoch.phase.detail } : {}),
      maxToolRounds,
      rounds: epoch.tierRounds,
      lastAction,
      observations: workerLedger.snapshot(),
    })
  // The worker's owed-Notice queue (#154): with every rail off, the only
  // Notice a worker ever owes is its own Finalize Instruction below.
  const notices = createNotices()
  // A worker has no user (#158): every Confirmation verdict is denied with
  // the wording the model has always read, and a stray interactive ask_user
  // — the orchestrator's tool, never the Subagent's escalation one — is
  // answered as the unknown tool it is rather than opening a window nobody
  // can close.
  const decisions: RunDecisions = {
    async *ask(_question, call) {
      return unknownToolError(call.name)
    },
    async *confirm() {
      return { approved: false, outcome: { ok: false, error: CONFIRMATION_REFUSAL } }
    },
  }
  // Cancellation is a worker's only interrupt (#158): the parent's Pause
  // gate parks it and its cancel flag ends it. Nothing steers a worker, so
  // `check` never returns a Directive and a round never ends steered.
  const interrupts: RunInterrupts = {
    async *check() {
      await checkpoint(options)
      return undefined
    },
    async *peek() {
      await checkpoint(options)
      return false
    },
    throwIfStopped() {
      if (options.isCancelled()) throw new SubagentCancelledError()
    },
  }
  // The Tool Round executor in Subagent configuration (#158/#159): the
  // gate order, the Blocker gate with the ASK_USER relay escalation, the
  // Subagent vision budget, the Observation ledger sink, and the Notices
  // delivery site are all inside it. Every capability flag is on (#159):
  // the worker's round runs the Run's search-loop rail, its no-progress
  // rails, and its per-call deadline gate, so the ADR 0027 promise that a
  // Browse Subagent runs the Run's Progress and Finalization discipline
  // is the executor's configuration rather than a second implementation.
  const toolRound = createToolRoundExecutor({
    clock,
    tools,
    effortEpoch: epoch,
    notices,
    observe: (input) => workerLedger.record(input),
    toolContext,
    decisions,
    interrupts,
    capabilities: { searchLoopRail: true, noProgressRail: true, perCallGate: true },
    terminalResult: (_call, outcome) => askEscalation(outcome) !== null,
    blockerEscalation: subagentBlockerEscalation,
    finalizationWording: workerFinalizationWording,
    visionCalls: MAX_SUBAGENT_VISION_CALLS,
    ...(deps.currentHost ? { currentHost: deps.currentHost } : {}),
    ...(deps.currentPageUrl ? { currentPageUrl: deps.currentPageUrl } : {}),
    ...(deps.settledPageState ? { settledPageState: deps.settledPageState } : {}),
    ...(deps.describeRef ? { describeRef: deps.describeRef } : {}),
  })

  // The worker's reasoning collector (#183): one per worker, only when the
  // spawning Run handed a trace down. Absent by default — with nothing
  // here the rounds do not stream and no reasoning is retained at all.
  const traceReasoning = options.traceReasoning
  const reasoningRounds = traceReasoning ? createReasoningRounds() : undefined
  /** Closes one round — or one abandoned attempt — and records its thinking. */
  const traceThinking = (round: ReasoningRound | undefined): void => {
    if (round === undefined || traceReasoning === undefined) return
    traceReasoning({ ...round, ...(options.agentId !== undefined ? { agentId: options.agentId } : {}) })
  }

  // The worker's llm_round collector (#191): one per worker, only when the
  // spawning Run handed the trace down. Numbered as the reasoning
  // collector beside it, so the two records of one attempt join.
  const traceLlmRound = options.traceLlmRound
  const llmRounds = traceLlmRound ? createLlmRounds() : undefined
  /** Closes one attempt — abandoned or the round's last — and records what it was sent under. */
  const closeLlmAttempt = (closed: LlmRound | undefined, request: LlmRequest): void => {
    if (closed === undefined || traceLlmRound === undefined) return
    traceLlmRound({
      ...closed,
      role: 'subagent',
      ...(request.reasoningEffort !== undefined ? { reasoningEffort: request.reasoningEffort } : {}),
      request: llmRequestShape(request),
      ...(options.agentId !== undefined ? { agentId: options.agentId } : {}),
    })
  }

  const requestArgs = (): LlmRequest => {
    const request: LlmRequest = {
      command: options.task,
      toolResults,
      // The Report Grace's end aborts the round in flight (#199): a
      // reserved report round the grace outran is abandoned rather than
      // left running past the answer it was going to feed.
      ...(options.abandonReport !== undefined ? { signal: options.abandonReport } : {}),
      // A worker carries no Effort Tier, so its epoch answers with the
      // Subagent rung (#166) — brief deliberation for execution work.
      reasoningEffort: epoch.reasoningEffort,
      ...(options.turnId !== undefined ? { turnId: options.turnId } : {}),
      ...(options.memory !== undefined && options.memory.length > 0 ? { memory: options.memory } : {}),
      // Streaming, only for the reasoning records (#183): a worker's rounds
      // have never streamed, and nothing here listens to a delta but the
      // collector — so the opt-in is what turns streaming on, and the round
      // stays non-streaming without it.
      ...(reasoningRounds
        ? {
            onDelta: (delta: LlmStreamDelta): void => reasoningRounds.onDelta(delta),
          }
        : {}),
      // A retried round leaves one record per attempt (#182, #191): the
      // abandoned attempt's thinking, and what it was sent under, stand on
      // their own rather than being folded into the attempt that survived.
      ...(reasoningRounds || llmRounds
        ? {
            onRetryAttempt: (): void => {
              if (reasoningRounds) traceThinking(reasoningRounds.takeAttempt())
              if (llmRounds) closeLlmAttempt(llmRounds.takeAttempt(), request)
            },
          }
        : {}),
      // Attempt identity (#191): what the client reports each attempt is
      // sent under; the next take carries it into the record.
      ...(llmRounds ? { onAttempt: (sent: LlmAttemptSent): void => llmRounds.onAttempt(sent) } : {}),
    }
    return request
  }

  for (;;) {
    await checkpoint(options)
    if (graceEnded()) return abandonedReport()
    const decision = epoch.decideLoopTop()
    if (decision.kind === 'finalize') {
      // Worker Finalization (#120/#149): one reserved Answer-only round —
      // the directive rides the last tool result — then, whatever the
      // model does with it, a bounded report. A run with no tool results
      // yet (the deadline passed before any work) has nothing to attach
      // the directive to and answers deterministically without the round.
      // Cancellation still wins at the checkpoint after the round.
      const rounds = epoch.tierRounds
      const observations = workerLedger.snapshot()
      if (toolResults.length === 0) {
        return boundedStopReport({ ...(options.agentId !== undefined ? { agentId: options.agentId } : {}), cause: decision.cause, ...(decision.detail !== undefined ? { detail: decision.detail } : {}), maxToolRounds, rounds, lastAction, observations })
      }
      // The directive rides through Notices (#154/#158) like every other
      // model-facing advisory line — as a must-ride kind, because the
      // reserved round is the model's last and a failed or structured last
      // result must not swallow the one instruction it needs.
      const last = toolResults[toolResults.length - 1]
      if (last !== undefined) {
        notices.owe('subagent_finalization', workerFinalizationNotice(decision.cause, maxToolRounds, decision.detail))
        last.outcome = notices.attach(last.outcome, { usefulWork: false })
      }
      let turn: AssistantTurn | null = null
      const answerRequest = requestArgs()
      try {
        turn = await llm.complete(answerRequest)
      } catch (error) {
        // The Report Grace ending aborts this round on purpose (#199), so
        // it is not a fault — the bounded report below is the designed
        // outcome. Anything else genuinely failed the reserved round.
        if (!graceEnded()) {
          reportFault('agent.subagentRunner.answerRound', error, { ...(options.turnId !== undefined ? { turnId: options.turnId } : {}) })
        }
        turn = null
      } finally {
        // The reserved Answer round thinks too, and a round that failed is
        // the one a diagnosis wants most (#183) — so its record is written
        // here, whatever the round did. Its llm_round record (#191) on the
        // same terms: usage only when the round returned.
        traceThinking(reasoningRounds?.takeRound())
        closeLlmAttempt(llmRounds?.takeRound(turn?.usage), answerRequest)
      }
      await checkpoint(options)
      // An Off-contract Reply in the reserved report round (#198, ADR
      // 0034): the worker narrating instead of reporting, one message after
      // the directive that stated the contract. Its prose would otherwise
      // become the report's text with an empty findings list, so an
      // orchestrator could not tell a worker that found nothing from one
      // that never reported. It is a failed round: the bounded report
      // stands in with the round's own cause, and the text is dropped —
      // never the report's text, never its findings.
      if (turn !== null && turn.kind === 'answer' && turn.shape === 'off_contract') {
        recordOffContractReply({
          site: 'agent.subagentRunner.offContractReply',
          role: 'subagent',
          shape: turn.shape,
          text: answerText(turn),
          cause: decision.cause,
          ...(options.traceOffContractReply !== undefined ? { trace: options.traceOffContractReply } : {}),
          ...(options.turnId !== undefined ? { turnId: options.turnId } : {}),
          ...(options.agentId !== undefined ? { agentId: options.agentId } : {}),
        })
      } else if (turn !== null && turn.kind === 'answer') {
        // The mechanical cause wins over the model's own conclusion, the
        // same precedence `finalizeRun` applies to a Run (#110/#162): the
        // worker answered because a rail told it to, not because it chose to.
        return reportFromTurn(turn, options.agentId, observations, decision.cause)
      }
      return boundedStopReport({ ...(options.agentId !== undefined ? { agentId: options.agentId } : {}), cause: decision.cause, ...(decision.detail !== undefined ? { detail: decision.detail } : {}), maxToolRounds, rounds, lastAction, observations })
    }

    let turn: AssistantTurn | null = null
    const request = requestArgs()
    let usage: TokenUsage | undefined
    try {
      turn = await llm.complete(request)
      usage = turn.usage
    } catch (error) {
      // The grace ended mid-round (#199): the abort is the parent's, not
      // a fault — the worker returns the bounded report below rather than
      // failing. Any other error is still the loop's to throw.
      if (!graceEnded()) throw error
    } finally {
      // One record per model round, written in a finally so a round that
      // threw leaves its thinking behind like one that returned (#183) —
      // and its llm_round record (#191) says what it was sent under.
      traceThinking(reasoningRounds?.takeRound())
      closeLlmAttempt(llmRounds?.takeRound(usage), request)
    }
    if (turn === null) return abandonedReport()
    await checkpoint(options)
    if (turn.kind === 'answer') {
      // A voluntary conclusion — no rail forced it (#162).
      return reportFromTurn(turn, options.agentId, workerLedger.snapshot(), 'model_answered')
    }

    // One round call (#158): the executor drains as a generator, and the
    // worker's only business inside it is progress reporting — one step per
    // call it announced, numbered by the round the epoch is counting.
    const round = toolRound.run(turn, options.turnId)
    let step = await round.next()
    while (step.done !== true) {
      const event = step.value
      // The worker's own record of the round (#185): every event, before
      // anything else reads it — the tap is what this stream is for.
      options.tracePipelineEvent?.(event, options.agentId)
      if (event.type === 'tool_call') {
        lastAction = describeToolAction(event.name, event.args)
        options.onProgress?.({ step: epoch.tierRounds, action: lastAction })
      }
      step = await round.next()
    }
    for (const result of step.value.results) {
      toolResults.push({ call: result.call, outcome: result.outcome })
    }
    // The ASK_USER relay ended the round (#18): a subagent cannot continue
    // until the orchestrator asks the user, so the directive is returned as
    // this worker's report verbatim — agent_results routes it upward. The
    // terminal end carries the tool's raw result (#164), so a Notice that
    // rode the escalation in-round never reaches the user welded to the
    // question.
    if (graceEnded()) return abandonedReport()
    const end = step.value.end
    const relay = end.kind === 'terminal' ? askEscalation(end.outcome) : null
    if (relay !== null) {
      // The relay stops the worker because only the user can unblock it,
      // and a worker can never reach one (#18/#162) — `user_unavailable`
      // in the shared vocabulary.
      return {
        text: relay,
        findings: [],
        unresolved: [],
        observations: workerLedger.snapshot(),
        finalizationCause: 'user_unavailable',
      }
    }
  }
}
