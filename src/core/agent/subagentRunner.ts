import type { Clock } from '../ports/clock'
import { toErrorMessage } from '../errors'
import { systemClock } from '../ports/clock'
import type { AssistantTurn, LlmClient, ToolResult, ToolResultOutcome } from '../ports/llm'
import type { Tool, ToolContext } from '../pipeline/tool'
import type { WorkingMemorySnapshot } from '../session/workingMemory'
import type { ObservationInput, ObservationRecord } from '../session/observationLedger'
import { createObservationLedger } from '../session/observationLedger'
import { VisionDeadlineError, VISION_DEADLINE_NUDGE } from '../ports/vision'
import { ASK_ESCALATION_PREFIX } from '../pipeline/askUserTools'
import { createBlockerGate, subagentBlockerEscalation } from '../pipeline/blockerGate'
import { createEffortEpoch } from '../pipeline/effortEpoch'
import type { FinalizationCause } from '../session/runJournal'
import { describeToolAction } from '../pipeline/toolCallDisplay'
import { classifyToolObservation } from '../pipeline/toolObservations'
import { createVisionBudget, MAX_SUBAGENT_VISION_CALLS } from './subagentRails'
import { droppedFindingsNote, validateReportFindings, type SubagentReport } from './subagentReport'

// The subagent workhorse loop (issue #13): one LLM (deepseek-chat via the
// model router) driving its own tool set until it produces a final report.
// No confirmations flow here (subagents cannot ask — the policy wrapper
// already downgraded confirm verdicts to denials); cancellation is polled at
// every checkpoint so a voice "stop" lands within one tool call. The report
// is structured (#98): the prose answer plus validated findings and
// unresolved items. Delegated Memory Entries (#98) ride every model round
// as untrusted data — the worker reads them, never writes them.
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
 * The Finalization directive for the worker's reserved Answer round
 * (#120): rides the last tool result the way the orchestrator's directive
 * rides its Finalization results — the model learns the work budget is
 * spent and that only the final report JSON is accepted now.
 */
// A Subagent epoch reports only these two of the Finalization Causes.
function workerFinalizationNotice(cause: FinalizationCause, maxToolRounds: number): string {
  const reason =
    cause === 'deadline_reached'
      ? 'The parent run\u2019s active-work deadline has passed'
      : `Your delegated work budget (${maxToolRounds} tool rounds) is spent`
  return `${reason}. Tool calls are closed. Reply now with ONLY your final report JSON — state honestly what you found and what remains open.`
}

/** Appends the directive to the last tool result so the reserved round carries it. */
function appendFinalizationNotice(toolResults: ToolResult[], notice: string): void {
  const last = toolResults.at(-1)
  if (last === undefined) return
  if (last.outcome.ok) {
    const payload =
      typeof last.outcome.result === 'string'
        ? last.outcome.result
        : (() => {
            try {
              return JSON.stringify(last.outcome.result)
            } catch {
              return 'tool result'
            }
          })()
    last.outcome = { ok: true, result: `${payload}\n\n${notice}` }
  } else {
    last.outcome = { ok: false, error: `${last.outcome.error}\n\n${notice}` }
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
  maxToolRounds: number
  rounds: number
  lastAction: string | null
  observations?: readonly ObservationRecord[]
}): SubagentReport {
  const causeSentence =
    input.cause === 'deadline_reached'
      ? 'the parent run reached its active-work deadline'
      : `the delegated work budget (${input.maxToolRounds} tool rounds) was spent`
  const lastActionSentence = input.lastAction !== null ? ` The last action was: ${input.lastAction}.` : ''
  return {
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
    text: `Stopped at the delegated work limit after ${input.rounds} tool round${input.rounds === 1 ? '' : 's'} — ${causeSentence}, and no final report was produced.${lastActionSentence}`,
    findings: [],
    unresolved: ['Cut short at the delegated work limit — the task is incomplete.'],
    ...(input.observations !== undefined && input.observations.length > 0 ? { observations: input.observations } : {}),
  }
}

/** One model answer turn becomes the report — both exits share the mapping. */
function reportFromTurn(
  turn: Extract<AssistantTurn, { kind: 'answer' }>,
  agentId: string | undefined,
  observations: readonly ObservationRecord[],
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
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]))
  const visionBudget = createVisionBudget(MAX_SUBAGENT_VISION_CALLS)
  // Same-wall Blocker gate (#81, ADR 0010): the orchestrator's gate with
  // one difference — subagents cannot ask the user directly, so the
  // refusal names the ASK_USER relay. Fresh per run, like the vision
  // budget; without it an ungated workhorse burns its rounds silently
  // against a wall.
  const blockerGate = createBlockerGate(deps.currentHost, subagentBlockerEscalation)
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
  const observe = (input: ObservationInput): void => {
    workerLedger.record(input)
  }
  const toolContext: ToolContext = {
    clock,
    acquireVision: () => visionBudget.tryAcquire(),
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
    },
  })

  const requestArgs = () => ({
    command: options.task,
    toolResults,
    ...(options.turnId !== undefined ? { turnId: options.turnId } : {}),
    ...(options.memory !== undefined && options.memory.length > 0 ? { memory: options.memory } : {}),
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
      appendFinalizationNotice(toolResults, workerFinalizationNotice(decision.cause, maxToolRounds))
      let turn: AssistantTurn | null = null
      try {
        turn = await llm.complete(requestArgs())
      } catch {
        turn = null
      }
      await checkpoint(options)
      if (turn !== null && turn.kind === 'answer') {
        return reportFromTurn(turn, options.agentId, observations)
      }
      return boundedStopReport({ ...(options.agentId !== undefined ? { agentId: options.agentId } : {}), cause: decision.cause, maxToolRounds, rounds, lastAction, observations })
    }

    const turn = await llm.complete(requestArgs())
    await checkpoint(options)
    if (turn.kind === 'answer') {
      return reportFromTurn(turn, options.agentId, workerLedger.snapshot())
    }

    epoch.beginToolRound()
    for (const call of turn.calls) {
      await checkpoint(options)
      lastAction = describeToolAction(call.name, call.args)
      options.onProgress?.({ step: epoch.tierRounds, action: lastAction })

      let outcome: ToolResultOutcome
      const tool = toolsByName.get(call.name)
      if (!tool) {
        outcome = { ok: false, error: `unknown tool: '${call.name}'` }
      } else {
        // Same-wall Blocker gate (#81), ahead of the risk tiers on
        // purpose — a call this run will not perform must never reach a
        // (downgraded) confirmation verdict.
        const gateVerdict = blockerGate.gate(call)
        if (!gateVerdict.ok) {
          outcome = { ok: false, error: gateVerdict.reason }
        } else {
          try {
            const verdict = tool.assessRisk ? await tool.assessRisk(call) : { kind: 'allow' as const }
            if (verdict.kind === 'deny') {
              outcome = { ok: false, error: verdict.reason }
            } else if (verdict.kind === 'confirm') {
              outcome = {
                ok: false,
                error: 'subagents cannot ask the user for confirmation — skip this action and report it back',
              }
            } else {
              let visionRefusal: string | null = null
              if (tool.usesVision) {
                const grant = visionBudget.tryAcquire()
                if (!grant.ok) visionRefusal = grant.reason
              }
              if (visionRefusal !== null) {
                outcome = { ok: false, error: visionRefusal }
              } else {
                const result = await tool.execute(call, toolContext)
                await checkpoint(options)
                if (typeof result === 'string' && result.startsWith(`${ASK_ESCALATION_PREFIX} `)) {
                  // A subagent cannot continue until the orchestrator asks the
                  // user. Return the directive as its report verbatim so
                  // agent_results reliably routes it upward; do not trust the
                  // workhorse model to preserve it in another round.
                  return { text: result, findings: [], unresolved: [], observations: workerLedger.snapshot() }
                }
                outcome = { ok: true, result }
              }
            }
          } catch (err) {
            if (err instanceof SubagentCancelledError) throw err
            // ADR 0016: a Subagent Look that missed the Vision Deadline gets
            // the same nudge the orchestrator's look gets — fall back to the
            // DOM or escalate; never keep retrying look blind.
            outcome = {
              ok: false,
              error:
                err instanceof VisionDeadlineError
                  ? `${err.message}\n${VISION_DEADLINE_NUDGE}`
                  : toErrorMessage(err),
            }
          }
        }
      }
      // Same-wall Blocker gate (#81): marker lines riding successful
      // results arm it; a successful different-host browser interaction
      // disarms it. Sees every processed outcome, like the orchestrator's.
      blockerGate.observe(call, outcome)
      // Worker Observation ledger (#123): the raw outcome as produced, with
      // the worker's own tab URL as the source of page-facing calls — the
      // ground the report's findings and the orchestrator's checkpoint for
      // them verify against.
      const classification = classifyToolObservation(call.name)
      const sourceUrl = classification.pageFacing ? deps.currentPageUrl?.() : undefined
      observe({
        producer: classification.producer,
        ok: outcome.ok,
        payload: outcome.ok ? outcome.result : outcome.error,
        ...(sourceUrl ? { sourceUrl } : {}),
      })
      toolResults.push({ call, outcome })
    }
  }
}
