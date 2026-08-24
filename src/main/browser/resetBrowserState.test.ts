import { describe, expect, it } from 'vitest'
import type { BrowserPane } from './createBrowserPane'
import type { SubagentRuntime } from '../agent/createSubagentRuntime'
import { resetBrowserState } from './resetBrowserState'

// #96: one reusable Browser State discard behind every Session end. The
// composition is the contract — cancel in-flight browsing agents, close
// their transient tabs without the linger, then reset the visible pane —
// in that order, all without touching the persistent Browser Profile.

function fakes() {
  const calls: string[] = []
  const pane = { reset: () => calls.push('pane.reset') } as unknown as BrowserPane
  const subagents = {
    cancelAll: () => {
      calls.push('cancelAll')
      return 0
    },
    closeAllTabs: () => {
      calls.push('closeAllTabs')
      return 0
    },
  } as unknown as SubagentRuntime
  return { calls, pane, subagents }
}

describe('resetBrowserState', () => {
  it('discards transient surfaces before the visible page, in one call', () => {
    const { calls, pane, subagents } = fakes()

    resetBrowserState(pane, subagents)

    expect(calls).toEqual(['cancelAll', 'closeAllTabs', 'pane.reset'])
  })
})
