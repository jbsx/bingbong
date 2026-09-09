import { describe, expect, it } from 'vitest'
import type { PerfSpanRecord } from '../../src/core/perf/perfTracer'
import type { PipelineEvent } from '../../src/core/pipeline/events'
import type { TraceRecord } from '../../src/core/trace/runTrace'
import type { SessionEventIdentity } from '../../src/core/pipeline/events'
import { extractLiveMetrics, finalAnswerDisplay, roleUsage, spanAggregates } from './metrics.ts'

// The raw projection (#224): observed timings and usage, never Task
// Success. The cases are the ones a report must keep apart — missing vs
// zero, invalid vs unavailable, a marked Answer vs the last display.

const identity = { runId: 'r1', sessionId: 's1', sessionGeneration: 1, submissionId: 'sub1' } as unknown as Required<SessionEventIdentity>

const events: PipelineEvent[] = [
  { type: 'command', turnId: 't1', text: 'find it', at: 1000, ...identity },
  { type: 'status', turnId: 't1', status: 'thinking', at: 1001, ...identity },
  { type: 'display', turnId: 't1', text: 'Working on it…', at: 1200, ...identity },
  { type: 'tool_call', turnId: 't1', callId: 'c1', name: 'navigate', args: { url: 'x' }, at: 1300, ...identity },
  { type: 'tool_result', turnId: 't1', callId: 'c1', name: 'navigate', ok: true, at: 1400, ...identity },
  { type: 'run_plan', turnId: 't1', objective: 'o', headline: null, effortTier: 'lookup', source: 'model', at: 1450, ...identity },
  { type: 'display', turnId: 't1', text: 'Here it is.', at: 1500, finalAnswer: true, ...identity },
  { type: 'speak', turnId: 't1', text: 'Here it is.', at: 1501, ...identity },
  { type: 'display', turnId: 't1', text: 'A late non-Answer display.', at: 1600, ...identity },
  { type: 'done', turnId: 't1', outcome: 'done', resolution: 'completed', finalizationCause: 'model_answered', at: 2000, ...identity },
]

const perf: PerfSpanRecord[] = [
  { turnId: 't1', stage: 'llm', durMs: 300, at: 1450, t: 1 },
  { turnId: 't1', stage: 'tool', durMs: 100, at: 1400, t: 2 },
  { turnId: 't1', stage: 'tts-synthesis', durMs: 50, at: 1550, t: 3 },
  { turnId: 't1', stage: 'tts-playback', durMs: 800, at: 2300, t: 4 },
]

function llmRound(overrides: Record<string, unknown>): TraceRecord {
  return {
    v: 1,
    at: 1450,
    turnId: 't1',
    runId: 'r1',
    sessionId: 's1',
    generation: 1,
    kind: 'llm_round',
    round: 1,
    attempt: 1,
    role: 'orchestrator',
    outcome: 'completed',
    reasoningChars: 0,
    request: { toolResults: 0, chars: 100 },
    ...overrides,
  } as TraceRecord
}

describe('extractLiveMetrics', () => {
  it('reads the marked final Answer, not the last display, and keeps Answer latency apart from Run duration', () => {
    const metrics = extractLiveMetrics({ events, perfRecords: perf, traceRecords: [], input: 'typed', clockOrigin: 'cap-1' })
    expect(metrics.answerBoundary).toBe('event_publication')
    expect(metrics.finalAnswerAt).toEqual({ status: 'observed', value: 1500 })
    expect(metrics.answerLatencyMs).toEqual({ status: 'observed', value: 500 })
    expect(metrics.runDurationMs).toEqual({ status: 'observed', value: 1000 })
    expect(metrics.userWaitMs).toEqual({ status: 'observed', value: 0 })
    expect(metrics.speech.inputLatencyMs.status).toBe('not_applicable')
    expect(metrics.speech.playback).toEqual({ status: 'observed', value: { spans: 1, totalMs: 800 } })
    expect(metrics.resolution).toBe('completed')
    expect(metrics.counts).toMatchObject({ llmSpans: 1, toolCalls: 1, toolSpans: 1, errors: 0 })
    expect(metrics.effortTier).toBe('lookup')
    expect('taskSuccess' in metrics).toBe(false)
  })

  it('leaves a missing Answer and a missing terminal unavailable rather than zero', () => {
    const aborted = events.filter((event) => event.type !== 'done' && !(event.type === 'display' && event.finalAnswer))
    const metrics = extractLiveMetrics({ events: aborted, perfRecords: [], traceRecords: [], input: 'typed', clockOrigin: 'cap-1' })
    expect(metrics.finalAnswerAt.status).toBe('unavailable')
    expect(metrics.answerLatencyMs.status).toBe('unavailable')
    expect(metrics.terminalAt.status).toBe('unavailable')
    expect(metrics.runDurationMs.status).toBe('unavailable')
    expect(metrics.outcome).toBeNull()
    expect(metrics.speech.playback.status).toBe('unavailable')
  })

  it('marks a clock anomaly invalid instead of reporting a negative latency', () => {
    const backwards = events.map((event) => (event.type === 'done' ? { ...event, at: 900 } : event))
    const metrics = extractLiveMetrics({ events: backwards, perfRecords: [], traceRecords: [], input: 'typed', clockOrigin: 'cap-1' })
    expect(metrics.runDurationMs.status).toBe('invalid')
    expect(metrics.answerLatencyMs).toEqual({ status: 'observed', value: 500 })
  })

  it('refuses to pick between two marked Answers', () => {
    const doubled = [...events, { type: 'display', turnId: 't1', text: 'again', at: 1700, finalAnswer: true, ...identity } as PipelineEvent]
    expect(finalAnswerDisplay(doubled).status).toBe('invalid')
  })

  it('sums resolved user waits and leaves an unresolved one unavailable', () => {
    const withAsk: PipelineEvent[] = [
      ...events.slice(0, 2),
      { type: 'ask_requested', turnId: 't1', askId: 'a1', callId: 'c9', question: 'which?', expiresAt: 9000, at: 1100, ...identity },
      { type: 'ask_resolved', turnId: 't1', askId: 'a1', answer: 'this', reason: 'user', at: 1350, ...identity },
      { type: 'confirmation_requested', turnId: 't1', confirmationId: 'k1', callId: 'c8', toolName: 'click', prompt: 'ok?', expiresAt: 9000, at: 1400, ...identity },
      ...events.slice(2),
    ]
    const metrics = extractLiveMetrics({ events: withAsk, perfRecords: [], traceRecords: [], input: 'typed', clockOrigin: 'cap-1' })
    expect(metrics.waits).toHaveLength(2)
    expect(metrics.userWaitMs.status).toBe('unavailable')
    const resolved = [...withAsk, { type: 'confirmation_resolved', turnId: 't1', confirmationId: 'k1', approved: true, reason: 'user', at: 1450, ...identity } as PipelineEvent]
    expect(extractLiveMetrics({ events: resolved, perfRecords: [], traceRecords: [], input: 'typed', clockOrigin: 'cap-1' }).userWaitMs).toEqual({ status: 'observed', value: 300 })
  })

  it('reports the deterministic fallback Answer as such', () => {
    const fallback = events.map((event) => (event.type === 'display' && event.finalAnswer ? { ...event, deterministicAnswer: true as const } : event))
    expect(extractLiveMetrics({ events: fallback, perfRecords: [], traceRecords: [], input: 'typed', clockOrigin: 'cap-1' }).deterministicAnswer).toBe(true)
  })
})

describe('spanAggregates', () => {
  it('sums per stage, unions overlapping intervals once, and skips summary and retry markers', () => {
    const stages = spanAggregates([
      { turnId: 't1', stage: 'tool', durMs: 100, at: 0, t: 100 },
      { turnId: 't1', stage: 'tool', durMs: 100, at: 0, t: 150 },
      { turnId: 't1', stage: 'tool', durMs: 50, at: 0, t: 400 },
      { turnId: 't1', stage: 'llm-retry', durMs: 0, at: 0, t: 120 },
      { turnId: 't1', stage: 'summary', durMs: 999, at: 0, t: 500, detail: {} },
    ])
    expect(stages).toEqual({ tool: { count: 3, totalMs: 250, unionMs: 200 } })
    const metrics = extractLiveMetrics({ events, perfRecords: perf, traceRecords: [], input: 'typed', clockOrigin: 'cap-1' })
    expect(metrics.spans).toMatchObject({ status: 'observed', value: { clockOrigin: 'cap-1', stages: { llm: { count: 1, totalMs: 300, unionMs: 300 } } } })
    expect(extractLiveMetrics({ events, perfRecords: [], traceRecords: [], input: 'typed', clockOrigin: 'cap-1' }).spans.status).toBe('unavailable')
  })

  it('times vision requests from their records without inventing tokens', () => {
    const records = [
      { v: 1, at: 1, turnId: 't1', kind: 'vision_request', capability: 'describe', reason: 'look', durationMs: 20, outcome: 'ok' },
      { v: 1, at: 2, turnId: 't1', kind: 'vision_request', capability: 'describe', reason: 'auto_vision', durationMs: 30, outcome: 'deadline' },
    ] as unknown as TraceRecord[]
    const metrics = extractLiveMetrics({ events, perfRecords: [], traceRecords: records, input: 'typed', clockOrigin: 'cap-1' })
    expect(metrics.vision).toEqual({ status: 'observed', value: { requests: 2, totalMs: 50, outcomes: { ok: 1, deadline: 1 } } })
    expect(metrics.usage.vision.status).toBe('unavailable')
  })
})

describe('roleUsage', () => {
  it('sums reported usage per role, flags a partial sum, and never reads vision tokens', () => {
    const usage = roleUsage([
      llmRound({ round: 1, model: 'glm', usage: { promptTokens: 100, completionTokens: 10 } }),
      llmRound({ round: 2, model: 'glm' }),
      llmRound({ round: 1, role: 'subagent', agentId: 'w1', model: 'deepseek', usage: { promptTokens: 5, completionTokens: 1 } }),
      { v: 1, at: 1, turnId: 't1', kind: 'vision_request', capability: 'describe', reason: 'look', durationMs: 20, outcome: 'ok' } as TraceRecord,
    ])
    expect(usage.orchestrator).toEqual({
      status: 'observed',
      value: { promptTokens: 100, completionTokens: 10, rounds: 2, roundsWithUsage: 1, complete: false, models: ['glm'] },
    })
    expect(usage.subagent).toMatchObject({ status: 'observed', value: { rounds: 1, complete: true } })
    expect(usage.vision.status).toBe('unavailable')
  })

  it('keeps no-usage and no-rounds apart, and neither is zero', () => {
    const usage = roleUsage([llmRound({ round: 1 })])
    expect(usage.orchestrator.status).toBe('unavailable')
    expect(usage.subagent.status).toBe('not_applicable')
    expect(extractLiveMetrics({ events, perfRecords: [], traceRecords: [], input: 'typed', clockOrigin: 'cap-1' }).usage.orchestrator.status).toBe('not_applicable')
  })
})
