import type { Clock } from '../ports/clock'
import { systemClock } from '../ports/clock'
import type { AssistantTurn, LlmClient, LlmStreamDelta, ToolResult, ToolResultOutcome } from '../ports/llm'
import type { Tool, ToolContext } from '../pipeline/tool'
import type { SettledPageState } from '../pipeline/progressFingerprints'
import type { SnapshotRef } from '../browser/snapshot'
import type { WorkingMemorySnapshot } from '../session/workingMemory'
import type { ObservationRecord } from '../session/observationLedger'
import { createObservationLedger } from '../session/observationLedger'
import { ASK_ESCALATION_PREFIX } from '../pipeline/askUserTools'
import { subagentBlockerEscalation } from '../pipeline/blockerGate'
import { createEffortEpoch } from '../pipeline/effortEpoch'
import { createNotices } from '../pipeline/notices'
import type { RunDecisions } from '../pipeline/decisions'
import type { RunInterrupts } from '../pipeline/interrupts'
import { createToolRoundExecutor, unknownToolError, type FinalizationWording } from '../pipeline/toolRound'
import type { FinalizationCause } from '../session/runJournal'
import { describeToolAction } from '../pipeline/toolCallDisplay'
import { MAX_SUBAGENT_VISION_CALLS } from './subagentRails'
import { droppedFindingsNote, validateReportFindings, type SubagentReport } from './subagentReport'
import { createReasoningRounds, type ReasoningRound, type WorkerReasoningTrace } from '../trace/reasoningTrace'

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
  /** Resolves immediately while running, or after the shared pause gate opens. */
  waitIfPaused?(): Promise<void>
  onProgress?(progress: SubagentProgress): void
  /**
   * The reasoning records for this worker's rounds (#183, ADR 0030):
   * built by the spawning Run over its own Run Trace writer, so each
   * record carries the parent Run's correlation keys and this worker's
   * `agentId`. Absent unless the developer set `BINGBONG_TRACE_REASONING`
   * — and with it absent the worker collects no reasoning and does not
   * stream, which is the path's historical behaviour.
   */
  traceReasoning?: WorkerReasoningTrace
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

const workerFinalizationWording: FinalizationWording = {
  toolRefusal: `Not executed \u2014 ${WORKER_FINALIZE_INSTRUCTION}`,
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
 * The Finalization directive for the worker's reserved Answer round
 * (#120): rides the last tool result the way the orchestrator's directive
 * rides its Finalization results — the model learns the work budget is
 * spent and that only the final report JSON is accepted now.
 */
// A Subagent epoch reports these three of the Finalization Causes (#159:
// `no_progress` joined the two budget causes when the worker adopted the
// Run's no-progress rails).
function workerFinalizationNotice(cause: FinalizationCause, maxToolRounds: number): string {
  const reason =
    cause === 'deadline_reached'
      ? 'The parent run\u2019s active-work deadline has passed'
      : cause === 'no_progress'
        ? 'Two Approaches in a row made no progress \u2014 repeated actions stopped producing anything new'
        : `Your delegated work budget (${maxToolRounds} tool rounds) is spent`
  return `${reason}. Tool calls are closed. Reply now with ONLY your final report JSON — state honestly what you found and what remains open.`
}

/**
 * The deterministic bounded report (#120): what the worker answers with
 * when its reserved Answer round fails or requests tools. Built only from
 * the stop cause and the run's own progress — it invents no findings.
 */
function boundedStopReport(input: {
  agentId?: string
  cause: FinalizationCause
  maxToolRounds: number
  rounds: number
  lastAction: string | null
  observations?: readonly ObservationRecord[]
}): SubagentReport {
  // The no-progress stop (#159) is not a spent limit: the worker had
  // budget left and stopped because repetition stopped paying, so it says
  // so rather than borrowing the budget wording.
  const noProgress = input.cause === 'no_progress'
  const causeSentence = noProgress
    ? 'two Approaches in a row made no progress'
    : input.cause === 'deadline_reached'
      ? 'the parent run reached its active-work deadline'
      : `the delegated work budget (${input.maxToolRounds} tool rounds) was spent`
  const leadIn = noProgress ? 'Stopped without progress' : 'Stopped at the delegated work limit'
  const lastActionSentence = input.lastAction !== null ? ` The last action was: ${input.lastAction}.` : ''
  return {
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
    text: `${leadIn} after ${input.rounds} tool round${input.rounds === 1 ? '' : 's'} — ${causeSentence}, and no final report was produced.${lastActionSentence}`,
    findings: [],
    unresolved: [
      noProgress
        ? 'Cut short with no progress left to make — the task is incomplete.'
        : 'Cut short at the delegated work limit — the task is incomplete.',
    ],
    ...(input.observations !== undefined && input.observations.length > 0 ? { observations: input.observations } : {}),
    finalizationCause: input.cause,
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
    text: turn.display !== '' ? turn.display : turn.speak,
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
  const toolContext: ToolContext = { clock }
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
    },
  })
  // The worker's owed-Notice queue (#154): with every rail off, the only
  // Notice a worker ever owes is its own Finalization directive below.
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
    capabilities: { searchLoopRail: true, noProgressRail: true, deadlineGate: true },
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

  const requestArgs = () => ({
    command: options.task,
    toolResults,
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
          // A retried round leaves one record per attempt (#182): the
          // abandoned attempt's thinking stands on its own rather than
          // being concatenated into the attempt that survived.
          onRetryAttempt: (): void => traceThinking(reasoningRounds.takeAttempt()),
        }
      : {}),
  })

  for (;;) {
    await checkpoint(options)
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
        return boundedStopReport({ ...(options.agentId !== undefined ? { agentId: options.agentId } : {}), cause: decision.cause, maxToolRounds, rounds, lastAction, observations })
      }
      // The directive rides through Notices (#154/#158) like every other
      // model-facing advisory line — as a must-ride kind, because the
      // reserved round is the model's last and a failed or structured last
      // result must not swallow the one instruction it needs.
      const last = toolResults[toolResults.length - 1]
      if (last !== undefined) {
        notices.owe('subagent_finalization', workerFinalizationNotice(decision.cause, maxToolRounds))
        last.outcome = notices.attach(last.outcome, { usefulWork: false })
      }
      let turn: AssistantTurn | null = null
      try {
        turn = await llm.complete(requestArgs())
      } catch {
        turn = null
      } finally {
        // The reserved Answer round thinks too, and a round that failed is
        // the one a diagnosis wants most (#183) — so its record is written
        // here, whatever the round did.
        traceThinking(reasoningRounds?.takeRound())
      }
      await checkpoint(options)
      if (turn !== null && turn.kind === 'answer') {
        // The mechanical cause wins over the model's own conclusion, the
        // same precedence `finalizeRun` applies to a Run (#110/#162): the
        // worker answered because a rail told it to, not because it chose to.
        return reportFromTurn(turn, options.agentId, observations, decision.cause)
      }
      return boundedStopReport({ ...(options.agentId !== undefined ? { agentId: options.agentId } : {}), cause: decision.cause, maxToolRounds, rounds, lastAction, observations })
    }

    let turn: AssistantTurn
    try {
      turn = await llm.complete(requestArgs())
    } finally {
      // One record per model round, written in a finally so a round that
      // threw leaves its thinking behind like one that returned (#183).
      traceThinking(reasoningRounds?.takeRound())
    }
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
