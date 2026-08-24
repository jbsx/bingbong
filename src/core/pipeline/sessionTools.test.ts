import { describe, expect, it } from 'vitest'
import { createNewSessionTool } from './sessionTools'
import { FakeClock } from '../testing/doubles'
import type { ToolCall } from '../ports/llm'

// new_session (spec #85, #99): the model-invoked Session Reset boundary.
// The tool declares itself as the reset and acknowledges — the isolation
// semantics (sibling suppression, run consumption, Session end and
// restart) live in the pipeline and command runner, tested there.

const call: ToolCall = { id: 'c1', name: 'new_session', args: {} }

describe('createNewSessionTool', () => {
  it('acknowledges the fresh thread in its tool result', async () => {
    const tool = createNewSessionTool()

    const result = await tool.execute(call, { clock: new FakeClock() })

    expect(result).toEqual(expect.stringContaining('Session cleared'))
  })

  it('declares the reset boundary and history gating', () => {
    const tool = createNewSessionTool()

    expect(tool.name).toBe('new_session')
    expect(tool.sessionReset).toBe(true)
    expect(tool.requiresHistory).toBe(true)
    expect(tool.parameters).toBeUndefined()
    expect(`${tool.name} ${tool.description ?? ''}`).toMatch(/forget|fresh|start/i)
  })
})
