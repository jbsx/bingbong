import { describe, expect, it } from 'vitest'
import { ScriptedLlm } from '../testing/doubles'
import { withUsageTracking } from './usageTracking'
import {
  DEFAULT_DAILY_SPEND_WARN_USD,
  dayKeyOf,
  emptyDailyUsage,
  estimateSpendUsd,
  recordUsage,
  sanitizeDailyUsage,
  summarizeUsage,
  type DailyUsage,
} from './spendEstimate'

// The warn-only daily spend estimate (issue #13): usage rides AssistantTurn
// from the OpenAI-compatible client, a tracking wrapper funnels it into a
// daily ledger, and a price table turns tokens into an estimate. Nothing
// blocks — the settings page just shows it, loudly, when it runs high.

describe('withUsageTracking', () => {
  it('records reported usage per completed turn', async () => {
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [], usage: { promptTokens: 120, completionTokens: 30 } },
      { kind: 'answer', speak: 's', display: 'd', usage: { promptTokens: 200, completionTokens: 50 } },
    ])
    const recorded: { role: string; model: string; usage?: { promptTokens: number; completionTokens: number } }[] = []
    const tracked = withUsageTracking(llm, 'subagent', () => 'deepseek-chat', (entry) => recorded.push(entry))

    await tracked.complete({ command: 't', toolResults: [] })
    await tracked.complete({ command: 't', toolResults: [] })

    expect(recorded).toEqual([
      { role: 'subagent', model: 'deepseek-chat', usage: { promptTokens: 120, completionTokens: 30 } },
      { role: 'subagent', model: 'deepseek-chat', usage: { promptTokens: 200, completionTokens: 50 } },
    ])
  })

  it('still counts a request when the API reports no usage', async () => {
    const llm = new ScriptedLlm([{ kind: 'answer', speak: 's', display: 'd' }])
    const recorded: { role: string; usage?: unknown }[] = []
    const tracked = withUsageTracking(llm, 'orchestrator', () => 'glm-4.6', (entry) => recorded.push(entry))

    await tracked.complete({ command: 't', toolResults: [] })

    expect(recorded).toEqual([{ role: 'orchestrator', model: 'glm-4.6', usage: undefined }])
  })

  it('passes turns through untouched', async () => {
    const llm = new ScriptedLlm([{ kind: 'answer', speak: 's', display: 'd', usage: { promptTokens: 1, completionTokens: 2 } }])
    const tracked = withUsageTracking(llm, 'orchestrator', () => 'glm-4.6', () => undefined)

    const turn = await tracked.complete({ command: 't', toolResults: [] })
    expect(turn).toMatchObject({ kind: 'answer', speak: 's', display: 'd' })
  })
})
describe('spend estimate', () => {
  it('prices deepseek and glm families, with a fallback for unknown models', () => {
    const usage = { promptTokens: 1_000_000, completionTokens: 500_000 }
    const deepseek = estimateSpendUsd('deepseek-chat', usage)
    const glm = estimateSpendUsd('glm-4.6', usage)
    const unknown = estimateSpendUsd('mystery-model', usage)

    expect(deepseek).toBeCloseTo(0.27 + 0.55, 4)
    expect(glm).toBe(unknown) // fallback is the glm-family price
    expect(glm).toBeGreaterThan(0)
  })

  it('estimates zero for zero usage', () => {
    expect(estimateSpendUsd('deepseek-chat', { promptTokens: 0, completionTokens: 0 })).toBe(0)
  })
})

describe('daily usage ledger', () => {
  it('merges entries per role+model and summarizes totals with a warn flag', () => {
    let state = emptyDailyUsage('2026-08-17')
    state = recordUsage(state, '2026-08-17', 'orchestrator', 'glm-4.6', { promptTokens: 10, completionTokens: 5 })
    state = recordUsage(state, '2026-08-17', 'orchestrator', 'glm-4.6', { promptTokens: 20, completionTokens: 5 })
    state = recordUsage(state, '2026-08-17', 'subagent', 'deepseek-chat', { promptTokens: 100, completionTokens: 50 })

    const summary = summarizeUsage(state, 0) // warn at $0 → always over
    expect(summary.date).toBe('2026-08-17')
    expect(summary.requests).toBe(3)
    expect(summary.promptTokens).toBe(130)
    expect(summary.completionTokens).toBe(60)
    expect(summary.estimateUsd).toBeGreaterThan(0)
    expect(summary.overWarn).toBe(true)
    expect(summary.byRole).toEqual({
      orchestrator: { requests: 2, promptTokens: 30, completionTokens: 10 },
      subagent: { requests: 1, promptTokens: 100, completionTokens: 50 },
    })
  })

  it('rolls over to a fresh day when the date changes', () => {
    let state = emptyDailyUsage('2026-08-17')
    state = recordUsage(state, '2026-08-17', 'subagent', 'deepseek-chat', { promptTokens: 100, completionTokens: 50 })

    state = recordUsage(state, '2026-08-18', 'subagent', 'deepseek-chat', { promptTokens: 1, completionTokens: 1 })

    expect(state.date).toBe('2026-08-18')
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]).toMatchObject({ requests: 1, promptTokens: 1, completionTokens: 1 })
  })

  it('summarizes a clean zero day without over-warning', () => {
    const summary = summarizeUsage(emptyDailyUsage('2026-08-17'), DEFAULT_DAILY_SPEND_WARN_USD)
    expect(summary.requests).toBe(0)
    expect(summary.estimateUsd).toBe(0)
    expect(summary.overWarn).toBe(false)
  })

  it('dayKeyOf renders local dates as YYYY-MM-DD', () => {
    expect(dayKeyOf(Date.UTC(2026, 7, 17, 12, 0, 0))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('sanitizes junk from disk into a valid (possibly empty) ledger', () => {
    expect(sanitizeDailyUsage(null).entries).toEqual([])
    expect(sanitizeDailyUsage({ date: 5, entries: [] }).entries).toEqual([])
    const valid = sanitizeDailyUsage({
      date: '2026-08-17',
      entries: [
        { role: 'subagent', model: 'deepseek-chat', requests: 2, promptTokens: 10, completionTokens: 5 },
        { role: 'wizard', model: 'x', requests: 1 },
        'junk',
      ],
    })
    expect(valid.date).toBe('2026-08-17')
    expect(valid.entries).toEqual([{ role: 'subagent', model: 'deepseek-chat', requests: 2, promptTokens: 10, completionTokens: 5 }])
  })

  it('counts requests without reported usage (tokens unknown, request counted)', () => {
    let state: DailyUsage = emptyDailyUsage('2026-08-17')
    state = recordUsage(state, '2026-08-17', 'orchestrator', 'glm-4.6', undefined)
    const summary = summarizeUsage(state, DEFAULT_DAILY_SPEND_WARN_USD)
    expect(summary.requests).toBe(1)
    expect(summary.estimateUsd).toBe(0)
  })
})
