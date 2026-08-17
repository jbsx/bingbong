import { describe, expect, it } from 'vitest'
import type { RiskVerdict, Tool } from './tool'
import { withoutConfirmations } from './subagentToolPolicy'

// Subagents cannot ask the user for confirmation — there is no ask_user
// channel behind a workhorse loop. Actions the risk gate would confirm are
// therefore denied for subagents (hard denies stay hard denies). Policy #23
// (downloads/submits need confirmation) keeps holding: no confirmation, no run.

describe('withoutConfirmations', () => {
  it('downgrades a confirm verdict to a denial worded for the subagent', async () => {
    let executions = 0
    const gated: Tool = {
      name: 'click',
      assessRisk: () => ({ kind: 'confirm', prompt: 'Download "file.zip"?' }),
      async execute() {
        executions += 1
        return 'clicked'
      },
    }

    const wrapped = withoutConfirmations([gated])
    const verdict = await wrapped[0].assessRisk!({ id: 'c1', name: 'click', args: {} })

    expect(verdict).toEqual({ kind: 'deny', reason: expect.stringMatching(/cannot ask the user for confirmation/i) })
    expect(executions).toBe(0)
  })

  it('keeps hard denies exactly as they are', async () => {
    const gated: Tool = {
      name: 'type',
      assessRisk: () => ({ kind: 'deny', reason: 'credential fields are never filled by the agent' }),
      async execute() {
        return 'typed'
      },
    }

    const verdict = await withoutConfirmations([gated])[0].assessRisk!({ id: 'c1', name: 'type', args: {} })
    expect(verdict).toEqual({ kind: 'deny', reason: 'credential fields are never filled by the agent' })
  })

  it('keeps allow verdicts and execution working', async () => {
    const gated: Tool = {
      name: 'navigate',
      assessRisk: () => ({ kind: 'allow' }),
      async execute() {
        return 'navigated'
      },
    }

    const wrapped = withoutConfirmations([gated])
    expect(await wrapped[0].assessRisk!({ id: 'c1', name: 'navigate', args: {} })).toEqual({ kind: 'allow' })
    expect(await wrapped[0].execute({ id: 'c1', name: 'navigate', args: {} }, { clock: { now: () => 0, setTimer: () => () => {} } })).toBe('navigated')
  })

  it('leaves ungated tools untouched', () => {
    const plain: Tool = {
      name: 'web_search',
      async execute() {
        return 'results'
      },
    }
    expect(withoutConfirmations([plain])[0]).toBe(plain)
  })

  it('assesses per call, not per tool — a mixed tool confirms nothing', async () => {
    const executed: string[] = []
    const verdicts: RiskVerdict[] = [
      { kind: 'confirm', prompt: 'Download "x.zip"?' },
      { kind: 'allow' },
      { kind: 'deny', reason: 'never' },
    ]
    let i = 0
    const gated: Tool = {
      name: 'mixed',
      assessRisk: () => {
        const verdict = verdicts[i] ?? { kind: 'allow' as const }
        i += 1
        return verdict
      },
      async execute() {
        executed.push('ran')
        return 'done'
      },
    }

    const wrapped = withoutConfirmations([gated])
    const results = [0, 1, 2].map((n) => wrapped[0].assessRisk!({ id: `c${n}`, name: 'mixed', args: {} }))
    expect((await results[0]).kind).toBe('deny')
    expect((await results[1]).kind).toBe('allow')
    expect((await results[2]).kind).toBe('deny')
    expect(executed).toEqual([]) // assessRisk never executes
  })
})
