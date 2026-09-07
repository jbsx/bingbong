import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../../src/core/pipeline/events'
import type { PerfSpanRecord } from '../../src/core/perf/perfTracer'
import { aggregateScenarios, combineRuns, extractMetrics, type ScenarioMetrics } from './metrics'

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

/** An Answer a model round wrote. */
function display(text: string, at: number): PipelineEvent {
  return { type: 'display', turnId: T, text, at }
}

/** The Answer the pipeline composed itself, flagged as the pipeline flags it. */
function fallbackDisplay(text: string, at: number): PipelineEvent {
  return { type: 'display', turnId: T, text, deterministicAnswer: true, at }
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

  it('counts the automatic Tier Escalations a run took, apart from the tier it ended at (#216)', () => {
    // Two runs end at Investigation; only one of them chose it. Without
    // the count the report cannot tell the declaration from the deadline.
    const escalated = extractMetrics(
      [
        command(0),
        { type: 'run_plan', turnId: T, objective: 'Find the list', headline: 'Find the list', effortTier: 'lookup', source: 'model', at: 1 },
        {
          type: 'run_plan',
          turnId: T,
          objective: 'Find the list',
          headline: 'Find the list',
          effortTier: 'investigation',
          source: 'deadline',
          escalationReason: 'The active-work deadline passed while the run was still making progress, so the Effort Tier rose one level.',
          at: 2,
        },
        done(3),
      ],
      [],
      false,
    )
    const declaredOnly = extractMetrics(
      [
        command(0),
        { type: 'run_plan', turnId: T, objective: 'Compare', headline: 'Compare', effortTier: 'investigation', source: 'model', at: 1 },
        done(2),
      ],
      [],
      false,
    )

    expect(escalated.effortTier).toBe('investigation')
    expect(escalated.deadlineTierEscalations).toBe(1)
    expect(declaredOnly.effortTier).toBe('investigation')
    expect(declaredOnly.deadlineTierEscalations).toBe(0)
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

  it('captures the failed call’s error text so runtime refusals stay scannable (#128)', () => {
    const refusal =
      'Not executed — this action repeats an equivalent action against unchanged page state. Change strategy.'
    const metrics = extractMetrics(
      [
        command(0),
        toolCall('a', 'navigate', { url: 'http://a/' }, 1),
        toolResult('a', 'navigate', true, 2),
        toolCall('b', 'navigate', { url: 'http://a/' }, 3),
        { type: 'tool_result', turnId: T, callId: 'b', name: 'navigate', ok: false, error: refusal, at: 4 },
        done(5),
      ],
      [],
      false,
    )
    expect(metrics.actions.find((action) => action.ok)?.error).toBeNull()
    expect(metrics.actions.find((action) => !action.ok)?.error).toBe(refusal)
  })

  it('flags an ask_user that timed out unanswered, not one the user answered (#130)', () => {
    const timedOut = extractMetrics(
      [
        command(0),
        { type: 'ask_requested', turnId: T, askId: 'q1', callId: 'a', question: 'Which one?', expiresAt: 1, at: 1 },
        { type: 'ask_resolved', turnId: T, askId: 'q1', answer: null, reason: 'timeout', at: 2 },
        done(3),
      ],
      [],
      false,
    )
    const answered = extractMetrics(
      [
        command(0),
        { type: 'ask_requested', turnId: T, askId: 'q2', callId: 'a', question: 'Which one?', expiresAt: 1, at: 1 },
        { type: 'ask_resolved', turnId: T, askId: 'q2', answer: 'the red one', reason: 'user', at: 2 },
        done(3),
      ],
      [],
      false,
    )
    expect(timedOut.askTimedOut).toBe(true)
    expect(answered.askTimedOut).toBe(false)
  })

  it('counts delegated workers by how they stopped, and records none when nothing was delegated (#162)', () => {
    const worker = (agentId: string, cause: 'no_progress' | 'model_answered' | 'deadline_reached', at: number): PipelineEvent => ({
      type: 'subagent_finalized',
      turnId: T,
      agentId,
      kind: 'browse',
      status: 'completed',
      cause,
      at,
    })
    const delegated = extractMetrics(
      [command(0), worker('a-1', 'model_answered', 1), worker('a-2', 'no_progress', 2), worker('a-3', 'no_progress', 3), done(4)],
      [],
      false,
    )
    expect(delegated.subagentFinalizations).toEqual({ model_answered: 1, no_progress: 2 })
    expect(extractMetrics([command(0), done(1)], [], false).subagentFinalizations).toEqual({})
  })

  it('counts a worker the parent run cancelled, and a failed one, under the status they ended on (#162)', () => {
    const ended = (agentId: string, status: 'cancelled' | 'failed', at: number): PipelineEvent => ({
      type: 'subagent_finalized',
      turnId: T,
      agentId,
      kind: 'browse',
      status,
      at,
    })
    // Since #199 Finalization no longer cancels, so these statuses mean a
    // decision was taken — a Stop, a `cancel_agent`, a Session Reset — or
    // the worker failed. Three delegated and ended must never read as
    // none delegated.
    const metrics = extractMetrics(
      [command(0), ended('a-1', 'cancelled', 1), ended('a-2', 'cancelled', 2), ended('a-3', 'failed', 3), done(4)],
      [],
      false,
    )
    expect(metrics.subagentFinalizations).toEqual({ cancelled: 2, failed: 1 })
  })

  it('never reads a completed worker without a cause as a kill (#162)', () => {
    // A worker that finished but whose report reached the tape with no
    // Finalization Cause is not a worker the parent killed. Calling it
    // 'cancelled' would erase the one distinction #162 exists to make,
    // and would inflate the kill column the delegation probe reads.
    const completedUncaused: PipelineEvent = {
      type: 'subagent_finalized',
      turnId: T,
      agentId: 'a-1',
      kind: 'browse',
      status: 'completed',
      at: 1,
    }
    const metrics = extractMetrics([command(0), completedUncaused, done(2)], [], false)
    expect(metrics.subagentFinalizations).toEqual({ uncaused: 1 })
  })

  it('counts how many of those reports were the bounded fallback (#199, ADR 0035)', () => {
    const worker = (agentId: string, bounded: boolean, at: number): PipelineEvent => ({
      type: 'subagent_finalized',
      turnId: T,
      agentId,
      kind: 'browse',
      status: 'completed',
      cause: 'parent_finalized',
      ...(bounded ? { bounded: true as const } : {}),
      at,
    })
    // The same stop cause reads differently depending on it: three
    // `parent_finalized` workers of which two never wrote a report is a
    // Report Grace that is too short, not a Finalization that worked.
    const metrics = extractMetrics(
      [command(0), worker('a-1', false, 1), worker('a-2', true, 2), worker('a-3', true, 3), done(4)],
      [],
      false,
    )
    expect(metrics.subagentFinalizations).toEqual({ parent_finalized: 3 })
    expect(metrics.subagentBoundedReports).toBe(2)
    expect(extractMetrics([command(0), done(1)], [], false).subagentBoundedReports).toBe(0)
  })

  it('derives seconds per model round from the run\u2019s own wall time and round count (#214)', () => {
    // The measurement the deadline work needs: a tier's deadline is only
    // derivable from what one round of that tier actually costs.
    const metrics = extractMetrics([command(1_000), done(76_000)], [span('llm'), span('llm'), span('llm')], false)
    expect(metrics.elapsedMs).toBe(75_000)
    expect(metrics.secondsPerLlmRound).toBe(25)
    // A run with no timing, and a run that never reached a model round,
    // measure nothing rather than dividing into a number.
    expect(extractMetrics([command(0)], [span('llm')], true).secondsPerLlmRound).toBeNull()
    expect(extractMetrics([command(0), done(9_000)], [], false).secondsPerLlmRound).toBeNull()
  })

  it('reads the Answer\u2019s origin from the pipeline\u2019s flag, never from its wording (#214)', () => {
    // The fallback's sentences are product-owned prose that has already
    // been reworded twice (#137, #203). Sourcing the metric from the
    // pipeline's own flag is what makes it survive the next rewording.
    const reworded = 'Nothing I can show for \u201Cdo it\u201D so far.'
    expect(extractMetrics([command(0), fallbackDisplay(reworded, 1), done(2)], [], false)).toMatchObject({
      answerText: reworded,
      deterministicAnswer: true,
    })
    // A model Answer that happens to word itself the same way is not the
    // fallback — only the flag says so.
    expect(extractMetrics([command(0), display(reworded, 1), done(2)], [], false).deterministicAnswer).toBe(false)
    // No Answer at all is not a deterministic Answer.
    expect(extractMetrics([command(0), done(1)], [], false).deterministicAnswer).toBe(false)
  })
})

describe('combineRuns', () => {
  const run = (overrides: Partial<ScenarioMetrics>): ScenarioMetrics => ({
    ...extractMetrics([command(0), done(1)], [], false),
    ...overrides,
  })

  it('sums work across runs and takes semantics from the final run', () => {
    const combined = combineRuns([
      run({ llmRounds: 3, attemptedTools: 4, executedTools: 4, elapsedMs: 10_000, outcome: 'cancelled', answerText: null }),
      run({ llmRounds: 2, attemptedTools: 1, executedTools: 1, elapsedMs: 5_000, outcome: 'done', resolution: 'completed', answerText: '5 years' }),
    ])
    expect(combined.llmRounds).toBe(5)
    expect(combined.attemptedTools).toBe(5)
    expect(combined.executedTools).toBe(5)
    expect(combined.elapsedMs).toBe(15_000)
    expect(combined.outcome).toBe('done')
    expect(combined.resolution).toBe('completed')
    expect(combined.answerText).toBe('5 years')
  })

  it('carries any run’s raw-limit failure and timeout, and both runs’ actions', () => {
    const combined = combineRuns([
      run({
        actions: [{ name: 'navigate', args: { url: 'http://a/' }, ok: true, repeated: false, error: null }],
      }),
      run({
        elapsedMs: null,
        rawLimitFailure: 'tool round limit (32) reached',
        timedOut: true,
        actions: [{ name: 'read_page', args: {}, ok: false, repeated: false, error: 'nope' }],
      }),
    ])
    expect(combined.rawLimitFailure).toBe('tool round limit (32) reached')
    expect(combined.timedOut).toBe(true)
    expect(combined.actions.map((action) => action.name)).toEqual(['navigate', 'read_page'])
    expect(combined.elapsedMs).toBeNull()
  })

  it('sums the delegated-worker breakdown across a scenario\u2019s runs (#162)', () => {
    const combined = combineRuns([
      run({ subagentFinalizations: { model_answered: 1, no_progress: 1 } }),
      run({ subagentFinalizations: { no_progress: 2, deadline_reached: 1 } }),
    ])
    expect(combined.subagentFinalizations).toEqual({ model_answered: 1, no_progress: 3, deadline_reached: 1 })
  })

  it('rates seconds per round over the summed work, and takes the Answer\u2019s origin from the final run (#214)', () => {
    const combined = combineRuns([
      run({ llmRounds: 2, elapsedMs: 10_000, deterministicAnswer: true }),
      run({ llmRounds: 3, elapsedMs: 20_000, deterministicAnswer: false }),
    ])
    // Work counters sum, so the rate is the scenario's own 30s over 5
    // rounds \u2014 never an average of the two runs' rates.
    expect(combined.secondsPerLlmRound).toBe(6)
    // The Answer the user keeps is the final run's, and so is its origin.
    expect(combined.deterministicAnswer).toBe(false)
    expect(combineRuns([run({ deterministicAnswer: false }), run({ deterministicAnswer: true })]).deterministicAnswer).toBe(true)
  })
})

describe('aggregateScenarios', () => {
  const metricsOf = (overrides: Partial<ScenarioMetrics>): ScenarioMetrics => ({
    llmRounds: 0,
    attemptedTools: 0,
    executedTools: 0,
    elapsedMs: null,
    secondsPerLlmRound: null,
    repeatedActions: 0,
    deadlineTierEscalations: 0,
    outcome: 'done' as const,
    effortTier: 'lookup' as const,
    resolution: null,
    finalizationCause: null,
    rawLimitFailure: null,
    askTimedOut: false,
    deterministicAnswer: false,
    subagentFinalizations: {},
    subagentBoundedReports: 0,
    actions: [],
    answerText: 'x',
    timedOut: false,
    ...overrides,
  })

  it('uses nearest-rank median and p95 over the measured scenarios', () => {
    const of = (rounds: number, elapsedMs: number, success: boolean) => {
      const run = metricsOf({ llmRounds: rounds, attemptedTools: rounds, executedTools: rounds, elapsedMs })
      return { success, metrics: run, runs: [run] }
    }
    const aggregate = aggregateScenarios([of(2, 100, true), of(4, 300, true), of(8, 700, true), of(16, 1_500, false)])
    expect(aggregate.scenarioCount).toBe(4)
    expect(aggregate.objectiveSuccesses).toBe(3)
    expect(aggregate.llmRounds.median).toBe(4)
    expect(aggregate.llmRounds.p95).toBe(16)
    expect(aggregate.elapsedMs.median).toBe(300)
    expect(aggregate.elapsedMs.p95).toBe(1_500)
    expect(aggregate.rawLimitFailures).toBe(0)
  })

  it('aggregates seconds per round per Effort Tier over Runs, not scenarios (#214)', () => {
    // Each Run declares its own tier and spends its own deadline, so the
    // rate that a tier's deadline can be derived from is a Run's, not a
    // two-Run scenario's summed view.
    const runOf = (effortTier: ScenarioMetrics['effortTier'], secondsPerLlmRound: number): ScenarioMetrics =>
      metricsOf({ effortTier, secondsPerLlmRound })
    const aggregate = aggregateScenarios([
      { success: true, metrics: metricsOf({ effortTier: 'lookup' }), runs: [runOf('lookup', 4), runOf('lookup', 6)] },
      { success: true, metrics: metricsOf({ effortTier: 'lookup' }), runs: [runOf('lookup', 20)] },
      { success: false, metrics: metricsOf({ effortTier: 'investigation' }), runs: [runOf('investigation', 13)] },
    ])
    expect(aggregate.secondsPerLlmRound.lookup).toEqual({ median: 6, p95: 20 })
    expect(aggregate.secondsPerLlmRound.investigation).toEqual({ median: 13, p95: 13 })
    // A tier no Run declared is absent, never a zero that reads as fast.
    expect(aggregate.secondsPerLlmRound.direct_action).toBeUndefined()
    expect(aggregate.measuredRuns).toBe(4)
  })

  it('counts the Runs whose Answer the user heard was the deterministic one (#214)', () => {
    const aggregate = aggregateScenarios([
      {
        success: false,
        metrics: metricsOf({ deterministicAnswer: true }),
        runs: [metricsOf({ deterministicAnswer: false }), metricsOf({ deterministicAnswer: true })],
      },
      { success: true, metrics: metricsOf({ deterministicAnswer: false }), runs: [metricsOf({ deterministicAnswer: false })] },
    ])
    expect(aggregate.deterministicAnswers).toBe(1)
    expect(aggregate.measuredRuns).toBe(3)
  })
})
