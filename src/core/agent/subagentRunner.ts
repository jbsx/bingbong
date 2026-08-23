import type { Clock } from '../ports/clock'
import { systemClock } from '../ports/clock'
import type { LlmClient, ToolResult, ToolResultOutcome } from '../ports/llm'
import type { Tool, ToolContext } from '../pipeline/tool'
import { ASK_ESCALATION_PREFIX } from '../pipeline/askUserTools'
import { createBlockerGate, subagentBlockerEscalation } from '../pipeline/blockerGate'
import { describeToolAction } from '../pipeline/toolCallDisplay'
import { createVisionBudget, MAX_SUBAGENT_VISION_CALLS } from './subagentRails'

// The subagent workhorse loop (issue #13): one LLM (deepseek-chat via the
// model router) driving its own tool set until it produces a final report.
// No confirmations flow here (subagents cannot ask — the policy wrapper
// already downgraded confirm verdicts to denials); cancellation is polled at
// every checkpoint so a voice "stop" lands within one tool call.

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
   * Absent — like a research subagent with no tab — the gate only
   * matches navigate calls it can classify by URL.
   */
  currentHost?(): string | null
}

export interface RunSubagentOptions {
  task: string
  /**
   * The orchestrator turn that spawned this agent (#29): stamped on every
   * model round so a perf-wrapped client keys its spans to that turn.
   */
  turnId?: string
  /** Polled before each model call and each tool call. */
  isCancelled(): boolean
  /** Resolves immediately while running, or after the shared pause gate opens. */
  waitIfPaused?(): Promise<void>
  onProgress?(progress: SubagentProgress): void
}

export class SubagentCancelledError extends Error {
  constructor() {
    super('subagent cancelled by the user')
  }
}

const DEFAULT_MAX_TOOL_ROUNDS = 20

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function checkpoint(options: RunSubagentOptions): Promise<void> {
  if (options.isCancelled()) throw new SubagentCancelledError()
  await options.waitIfPaused?.()
  if (options.isCancelled()) throw new SubagentCancelledError()
}

export async function runSubagent(deps: RunSubagentDeps, options: RunSubagentOptions): Promise<string> {
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
  const toolContext: ToolContext = {
    clock,
    acquireVision: () => visionBudget.tryAcquire(),
  }
  const toolResults: ToolResult[] = []
  let rounds = 0

  for (;;) {
    await checkpoint(options)
    if (rounds >= maxToolRounds) {
      throw new Error(`subagent tool round limit (${maxToolRounds}) reached`)
    }

    const turn = await llm.complete({
      command: options.task,
      toolResults,
      ...(options.turnId !== undefined ? { turnId: options.turnId } : {}),
    })
    await checkpoint(options)
    if (turn.kind === 'answer') {
      return turn.display !== '' ? turn.display : turn.speak
    }

    rounds += 1
    for (const call of turn.calls) {
      await checkpoint(options)
      options.onProgress?.({ step: rounds, action: describeToolAction(call.name, call.args) })

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
                  return result
                }
                outcome = { ok: true, result }
              }
            }
          } catch (err) {
            if (err instanceof SubagentCancelledError) throw err
            outcome = { ok: false, error: toErrorMessage(err) }
          }
        }
      }
      // Same-wall Blocker gate (#81): marker lines riding successful
      // results arm it; a successful different-host browser interaction
      // disarms it. Sees every processed outcome, like the orchestrator's.
      blockerGate.observe(call, outcome)
      toolResults.push({ call, outcome })
    }
  }
}
