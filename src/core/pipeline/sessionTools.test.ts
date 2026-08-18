import { describe, expect, it } from 'vitest'
import { createNewSessionTool } from './sessionTools'
import { FakeClock } from '../testing/doubles'
import type { ToolCall } from '../ports/llm'

// new_session (spec #24): the model-invoked session reset. The tool clears
// the store through the same seam the pipeline reads; its result string is
// the only confirmation — the model's natural reply acknowledges the fresh
// start, with no canned voice line anywhere.

const call: ToolCall = { id: 'c1', name: 'new_session', args: {} }

describe('createNewSessionTool', () => {
  it('clears the session store and confirms it in the tool result', async () => {
    let cleared = 0
    const tool = createNewSessionTool({
      clear: () => {
        cleared += 1
      },
    })

    const result = await tool.execute(call, { clock: new FakeClock() })

    expect(cleared).toBe(1)
    expect(result).toEqual(expect.stringContaining('Session cleared'))
  })

  it('declares itself history-gated so fresh sessions keep the lean catalog', () => {
    const tool = createNewSessionTool({ clear: () => {} })

    expect(tool.name).toBe('new_session')
    expect(tool.requiresHistory).toBe(true)
    expect(tool.parameters).toBeUndefined()
    expect(`${tool.name} ${tool.description ?? ''}`).toMatch(/forget|fresh|start/i)
  })
})
