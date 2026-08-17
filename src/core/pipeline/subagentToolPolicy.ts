import type { RiskVerdict, Tool } from './tool'
import type { ToolCall } from '../ports/llm'

// Subagents have no ask_user channel: any action the risk gate would send to
// the confirm flow is denied outright for them, with a reason the workhorse
// model can act on (finish without it, or report the step back). Hard denies
// and allows pass through untouched; ungated tools are returned as-is.

const DENY_CONFIRMATION =
  'subagents cannot ask the user for confirmation — skip this action and continue without it'

export function withoutConfirmations(tools: Tool[]): Tool[] {
  return tools.map((tool) => {
    if (!tool.assessRisk) return tool
    const assess = tool.assessRisk.bind(tool)
    const wrapped: Tool = {
      ...tool,
      async assessRisk(call: ToolCall): Promise<RiskVerdict> {
        const verdict = await assess(call)
        if (verdict.kind === 'confirm') return { kind: 'deny', reason: DENY_CONFIRMATION }
        return verdict
      },
    }
    return wrapped
  })
}
