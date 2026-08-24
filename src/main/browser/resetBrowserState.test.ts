import { describe, expect, it } from 'vitest'
import type { BrowserPane } from './createBrowserPane'
import type { SubagentRuntime } from '../agent/createSubagentRuntime'
import { resetBrowserState } from './resetBrowserState'

// #96/#97: one reusable Session-end discard. The composition is the
// contract — retire the Session's subagents (cancel in-flight browsing
// agents, discard their reports, close and drop their transient tabs), then
// reset the visible pane — in that order, all without touching the
// persistent Browser Profile.

function fakes() {
  const calls: string[] = []
  const pane = { reset: () => calls.push('pane.reset') } as unknown as BrowserPane
  const subagents = {
    retire: () => {
      calls.push('retire')
      return 0
    },
  } as unknown as SubagentRuntime
  return { calls, pane, subagents }
}

describe('resetBrowserState', () => {
  it('retires the Session’s subagents before resetting the visible pane, in one call', () => {
    const { calls, pane, subagents } = fakes()

    resetBrowserState(pane, subagents)

    expect(calls).toEqual(['retire', 'pane.reset'])
  })
})
