import type { Clock } from '../ports/clock'
import { systemClock } from '../ports/clock'
import type { LlmClient, ToolResult, ToolResultOutcome } from '../ports/llm'
import type { Tool, ToolContext } from '../pipeline/tool'
import { describeToolAction } from '../pipeline/toolCallDisplay'
import { createVisionBudget } from './subagentRails'

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
}

export interface RunSubagentOptions {
  task: string
  /** Polled before each model call and each tool call. */
  isCancelled(): boolean
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

export async function runSubagent(deps: RunSubagentDeps, options: RunSubagentOptions): Promise<string> {
  const { llm, tools } = deps
  const clock = deps.clock ?? systemClock
  const maxToolRounds = deps.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]))
  const toolContext: ToolContext = { clock }
  const visionBudget = createVisionBudget()
  const toolResults: ToolResult[] = []
  let rounds = 0

  for (;;) {
    if (options.isCancelled()) throw new SubagentCancelledError()
    if (rounds >= maxToolRounds) {
      throw new Error(`subagent tool round limit (${maxToolRounds}) reached`)
    }

    const turn = await llm.complete({ command: options.task, toolResults })
    if (options.isCancelled()) throw new SubagentCancelledError()
    if (turn.kind === 'answer') {
      return turn.display !== '' ? turn.display : turn.speak
    }

    rounds += 1
    for (const call of turn.calls) {
      if (options.isCancelled()) throw new SubagentCancelledError()
      options.onProgress?.({ step: rounds, action: describeToolAction(call.name, call.args) })

      let outcome: ToolResultOutcome
      const tool = toolsByName.get(call.name)
      if (!tool) {
        outcome = { ok: false, error: `unknown tool: '${call.name}'` }
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
            if (tool.usesVision) {
              const grant = visionBudget.tryAcquire()
              if (!grant.ok) {
                outcome = { ok: false, error: grant.reason }
                toolResults.push({ call, outcome })
                continue
              }
            }
            const result = await tool.execute(call, toolContext)
            if (options.isCancelled()) throw new SubagentCancelledError()
            outcome = { ok: true, result }
          }
        } catch (err) {
          if (err instanceof SubagentCancelledError) throw err
          outcome = { ok: false, error: toErrorMessage(err) }
        }
      }
      toolResults.push({ call, outcome })
    }
  }
}
