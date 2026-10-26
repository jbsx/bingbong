import { describe, expect, it } from 'vitest'
import type { PerfSpanRecord } from './perfTracer'
import { buildPlannerReport, formatPlannerReport } from './plannerReport'

const step = (durMs: number, detail: Record<string, unknown>): PerfSpanRecord => ({ turnId: 't', stage: 'planner-step', durMs, at: 0, t: 0, detail })
const errand = (durMs: number, steps: number, outcome: string): PerfSpanRecord => ({ turnId: 'e', stage: 'errand', durMs, at: 0, t: 0, detail: { steps, outcome } })

describe('the Planner lines of pnpm perf:report (#465)', () => {
  it('reads planner-step latency by model, thinking and the host’s prompt-token band, and what the calls came to', () => {
    const report = buildPlannerReport([
      step(900, { model: 'glm-5.3', thinking: false, outcome: 'act', promptTokens: 1200 }),
      step(1100, { model: 'glm-5.3', thinking: false, outcome: 'done', promptTokens: 1400 }),
      step(4000, { model: 'glm-5.3', thinking: false, outcome: 'act', promptTokens: 4000 }),
      step(6000, { model: 'glm-5.3', thinking: true, outcome: 'ask', promptTokens: 1000 }),
      step(30000, { model: 'glm-5.3-flash', thinking: false, outcome: 'unavailable', reason: 'timeout' }),
      step(700, { model: 'glm-5.3-flash', thinking: false, outcome: 'choice', promptTokens: 2000 }),
      { turnId: 'x', stage: 'reaction', durMs: 300, at: 0, t: 0 },
    ])
    expect(formatPlannerReport(report)).toEqual([
      '',
      'planner-step latency by model, thinking and prompt tokens:',
      'model          thinking  tokens  count     p50     p95',
      'glm-5.3        off       < 1.5k      2   900ms  1100ms',
      'glm-5.3        off       3–6k        1  4000ms  4000ms',
      'glm-5.3        on        < 1.5k      1  6000ms  6000ms',
      'glm-5.3-flash  off       1.5–3k      1   700ms   700ms',
      'planner steps: 6 | act 2, ask 1, choice 1, done 1, unavailable 1 (timeout 1)',
    ])
  })

  it('reads the errand spans: how many, their steps and their seconds, and how they ended', () => {
    const report = buildPlannerReport([errand(20_000, 4, 'done'), errand(90_000, 9, 'cap'), errand(12_000, 2, 'done')])
    expect(formatPlannerReport(report)).toEqual(['', 'errands: 3 | steps p50 4 max 9 | p50 20000ms p95 90000ms | done 2, cap 1'])
  })

  it('says nothing when there is no Planner span', () => {
    expect(formatPlannerReport(buildPlannerReport([{ turnId: 'x', stage: 'reaction', durMs: 300, at: 0, t: 0 }]))).toEqual([])
  })
})
