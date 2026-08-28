import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../../src/core/pipeline/events'
import type { PerfSpanRecord } from '../../src/core/perf/perfTracer'
import { aggregateScenarios, extractMetrics } from './metrics'

const T = 'turn-test'

function command(at: number): PipelineEvent {
  return { type: 'command', turnId: T, text: 'do it', at }
}

function toolCall(callId: string, name: string, args: Record<string, unknown>, at: number): PipelineEvent {
  return { type: 'tool_call', turnId: T, callId, name, args, at }
}

function toolResult(callId: string, name: string, ok: boolean, at: number): PipelineEvent {
  return { type: 'tool_result', turnId: T, callId, name, ok, ...(ok ? { result: 'ok' } : { error: 'nope' }), at }
}

function done(
  at: number,
  outcome: 'done' | 'failed' = 'done',
  semantics?: { resolution?: 'completed' | 'partial'; finalizationCause?: 'model_answered' | 'hard_limit' },
): PipelineEvent {
  return {
    type: 'done',
    turnId: T,
    outcome,
    ...(semantics?.resolution ? { resolution: semantics.resolution } : {}),
    ...(semantics?.finalizationCause ? { finalizationCause: semantics.finalizationCause } : {}),
    at,
  }
}

function span(stage: string): PerfSpanRecord {
  return { turnId: T, stage, durMs: 10, at: 0, t: 0 }
}

describe('extractMetrics', () => {
  it('counts llm rounds and executed tools from perf spans, attempted from events', () => {
    const metrics = extractMetrics(
      [
        command(1_000),
        toolCall('c1', 'navigate', { url: 'http://a/' }, 2_000),
        toolResult('c1', 'navigate', true, 3_000),
        toolCall('c2', 'click', { ref: 1 }, 4_000),
        toolResult('c2', 'click', false, 5_000),
        done(6_000),
      ],
      [span('llm'), span('llm'), span('llm'), span('tool'), span('summary')],
      false,
    )
    expect(metrics.llmRounds).toBe(3)
    expect(metrics.attemptedTools).toBe(2)
    // Only calls that reached execute carry a tool span — the refused click does not.
    expect(metrics.executedTools).toBe(1)
    expect(metrics.outcome).toBe('done')
  })

  it('measures elapsed wall time from the run command to its done event', () => {
    const metrics = extractMetrics([command(10_000), done(73_000)], [], false)
    expect(metrics.elapsedMs).toBe(63_000)
  })

  it('flags repeated identical name+args calls, not same-tool-different-args', () => {
    const metrics = extractMetrics(
      [
        command(0),
        toolCall('a', 'navigate', { url: 'http://a/' }, 1),
        toolResult('a', 'navigate', true, 2),
        toolCall('b', 'navigate', { url: 'http://a/' }, 3),
        toolResult('b', 'navigate', true, 4),
        toolCall('c', 'navigate', { url: 'http://b/' }, 5),
        toolResult('c', 'navigate', true, 6),
        toolCall('d', 'click', { ref: 1 }, 7),
        toolResult('d', 'click', true, 8),
        done(9),
      ],
      [],
      false,
    )
    expect(metrics.repeatedActions).toBe(1)
    expect(metrics.actions.find((action) => action.repeated)?.args).toEqual({ url: 'http://a/' })
  })

  it('captures raw-limit failures and the final answer text', () => {
    const metrics = extractMetrics(
      [
        command(0),
        { type: 'display', turnId: T, text: 'partial answer', at: 1 },
        { type: 'display', turnId: T, text: 'final answer', at: 2 },
        { type: 'error', turnId: T, message: 'tool round limit (80) reached', at: 3 },
        done(4, 'failed'),
      ],
      [],
      false,
    )
    expect(metrics.rawLimitFailure).toBe('tool round limit (80) reached')
    expect(metrics.answerText).toBe('final answer')
    expect(metrics.outcome).toBe('failed')
  })

  it('records the run’s semantic Resolution and Finalization Cause from its done event (#110)', () => {
    const metrics = extractMetrics(
      [
        command(0),
        { type: 'display', turnId: T, text: 'Honest partial answer.', at: 1 },
        done(2, 'done', { resolution: 'partial', finalizationCause: 'model_answered' }),
      ],
      [],
      false,
    )
    expect(metrics.resolution).toBe('partial')
    expect(metrics.finalizationCause).toBe('model_answered')
  })

  it('records the latest declared Effort Tier, defaulting an undeclared plan to Lookup (#116)', () => {
    const declared = extractMetrics(
      [
        command(0),
        { type: 'run_plan', turnId: T, objective: 'Find it', headline: 'Find it', effortTier: 'lookup', source: 'model', at: 1 },
        { type: 'run_plan', turnId: T, objective: 'Compare sources', headline: 'Compare sources', effortTier: 'investigation', source: 'model', escalationReason: 'Sources disagreed.', at: 2 },
        done(3),
      ],
      [],
      false,
    )
    const fallback = extractMetrics([command(0), done(1)], [], false)
    const fallbackEvent = extractMetrics(
      [
        command(0),
        { type: 'run_plan', turnId: T, objective: 'do it', headline: null, effortTier: 'lookup', source: 'fallback', at: 1 },
        done(2),
      ],
      [],
      false,
    )

    expect(declared.effortTier).toBe('investigation')
    expect(fallback.effortTier).toBe('lookup')
    expect(fallbackEvent.effortTier).toBe('lookup')
  })

  it('records a hard-limit failure’s mechanical cause with no Resolution (#110)', () => {
    const metrics = extractMetrics(
      [command(0), { type: 'error', turnId: T, message: 'tool round limit (32) reached', at: 1 }, done(2, 'failed', { finalizationCause: 'hard_limit' })],
      [],
      false,
    )
    expect(metrics.resolution).toBeNull()
    expect(metrics.finalizationCause).toBe('hard_limit')
  })

  it('records a timed-out run with no done event honestly', () => {
    const metrics = extractMetrics([command(0), toolCall('a', 'navigate', { url: 'http://a/' }, 1)], [], true)
    expect(metrics.timedOut).toBe(true)
    expect(metrics.outcome).toBeNull()
    expect(metrics.elapsedMs).toBeNull()
  })
})

describe('aggregateScenarios', () => {
  it('uses nearest-rank median and p95 over the measured scenarios', () => {
    const of = (rounds: number, elapsedMs: number, success: boolean) => ({
      success,
      metrics: {
        llmRounds: rounds,
        attemptedTools: rounds,
        executedTools: rounds,
        elapsedMs,
        repeatedActions: 0,
        outcome: 'done' as const,
        effortTier: 'lookup' as const,
        resolution: null,
        finalizationCause: null,
        rawLimitFailure: null,
        actions: [],
        answerText: 'x',
        timedOut: false,
      },
    })
    const aggregate = aggregateScenarios([of(2, 100, true), of(4, 300, true), of(8, 700, true), of(16, 1_500, false)])
    expect(aggregate.scenarioCount).toBe(4)
    expect(aggregate.objectiveSuccesses).toBe(3)
    expect(aggregate.llmRounds.median).toBe(4)
    expect(aggregate.llmRounds.p95).toBe(16)
    expect(aggregate.elapsedMs.median).toBe(300)
    expect(aggregate.elapsedMs.p95).toBe(1_500)
    expect(aggregate.rawLimitFailures).toBe(0)
  })
})
