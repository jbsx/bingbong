import { describe, expect, it } from 'vitest'
import type { ToolCall } from '../ports/llm'
import { createAskUserTool, createSubagentAskTool, ASK_ESCALATION_PREFIX } from './askUserTools'

const ctx = { clock: { now: () => 0, setTimer: () => () => {} } }

function call(args: Record<string, unknown>): ToolCall {
  return { id: 'c1', name: 'ask_user', args }
}

describe('orchestrator ask_user tool', () => {
  it('declares its question for the pipeline ask flow', () => {
    const tool = createAskUserTool()

    expect(tool.askUser?.(call({ question: 'Which city do you mean?' }))).toBe('Which city do you mean?')
  })

  it('surfaces the answer semantics in its description', () => {
    const tool = createAskUserTool()

    expect(tool.description).toMatch(/user didn't answer/)
  })
})

describe('subagent ask_user escalation tool', () => {
  const tool = createSubagentAskTool()

  it('returns an escalation directive carrying the question, not an answer', async () => {
    const result = await tool.execute(call({ question: 'Which city do you mean?' }), ctx)

    expect(result).toContain(`${ASK_ESCALATION_PREFIX} Which city do you mean?`)
    expect(result).toMatch(/orchestrator/i)
    expect(result).toMatch(/report/i)
  })

  it('is never an interactive ask — no pipeline declaration', () => {
    expect(tool.askUser).toBeUndefined()
  })

  it('rejects a missing question', async () => {
    await expect(tool.execute(call({}), ctx)).rejects.toThrow(/question/)
  })
})
