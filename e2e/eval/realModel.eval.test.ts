import { afterAll, beforeAll, expect, it } from 'vitest'
import { startEvaluator, type Evaluator } from './evaluator'
import { evalScenarios } from './scenarios'
import type { WorkerStop } from './metrics'

// The real-model evaluation suite (#109) — opt-in by design:
//
//   pnpm test:eval                                                       # scratch capture
//   BINGBONG_EVAL_REPORT=e2e/eval/pools/<side>/pass-<n>-<commit8>.json pnpm test:eval
//                                                                         # a pool pass (#132)
//
// It is deliberately outside `pnpm test:e2e`'s include pattern: it spends
// real model budget against the developer's production routing, so it runs
// only when asked, always under Xvfb like every Electron suite here. Every
// pool pass targets its own artifact — a finalized capture is never
// overwritten — and the release decision (`pnpm eval:accept`) pools
// exactly three passes per side (#132).
//
// Scenario success is measurement, not assertion — a failing scenario is
// baseline data for #108, and so is a timed-out one. What DOES fail this
// suite is broken measurement: missing routing, a scripted model in a
// serving position, or a scenario that never produced a run (those throw
// inside runScenario's own waits).

let evaluator: Evaluator

beforeAll(async () => {
  evaluator = await startEvaluator({
    reportPath: process.env.BINGBONG_EVAL_REPORT,
  })
})

afterAll(async () => {
  // beforeAll failing (no routing, harness failure) already fails the suite.
  if (!evaluator) return
  try {
    const report = await evaluator.finish()
    const agg = report.aggregate!
    // The scripted-model proof, runtime side: the app's usage ledger must
    // show the resolved orchestrator model served every round, and no
    // scripted entry anywhere.
    expect(report.modelWitness.scriptedEntries).toEqual([])
    expect(report.modelWitness.orchestratorModel).toBe(
      report.routing.orchestrator.configured ? report.routing.orchestrator.model : null,
    )
    expect(report.modelWitness.orchestratorRequests).toBeGreaterThan(0)
    // Delegated-worker stops (#162): summed over every scenario's runs and
    // printed, never gated — the measurement #161 asks for.
    const workerStops: Partial<Record<WorkerStop, number>> = {}
    for (const scenario of report.scenarios) {
      for (const [stop, count] of Object.entries(scenario.metrics.subagentFinalizations ?? {}) as [WorkerStop, number][]) {
        workerStops[stop] = (workerStops[stop] ?? 0) + count
      }
    }
    const workerLine = Object.entries(workerStops)
      .map(([stop, count]) => `${stop} ${count}`)
      .join('  ')
    console.log(
      [
        '',
        `real-model evaluation: ${agg.objectiveSuccesses}/${agg.scenarioCount} scenarios met their objective`,
        `  llm rounds     median ${agg.llmRounds.median}  p95 ${agg.llmRounds.p95}`,
        `  elapsed      ${Math.round(agg.elapsedMs.median / 1000)}s median  ${Math.round(agg.elapsedMs.p95 / 1000)}s p95`,
        `  raw-limit failures: ${agg.rawLimitFailures}   timed out: ${agg.timedOutScenarios}`,
        `  delegated workers: ${workerLine === '' ? 'none delegated' : workerLine}`,
        `  model: ${report.modelWitness.orchestratorModel} (${report.modelWitness.orchestratorRequests} rounds witnessed)`,
        '',
      ].join('\n'),
    )
  } finally {
    await evaluator.quit()
  }
})

for (const scenario of evalScenarios()) {
  // Two-run scenarios (cancelled-work, stale evidence) get two scenario
  // budgets plus collection overhead — 35 minutes bounds the worst case.
  it(`records the ${scenario.kind} scenario (${scenario.id})`, { timeout: 35 * 60_000 }, async () => {
    const result = await evaluator.runScenario(scenario)
    // Success, failure, and timeout are all recorded data — logged, not asserted.
    const runs = result.runs.length > 1 ? ` over ${result.runs.length} runs` : ''
    console.log(
      `[eval] ${result.success ? 'PASS' : 'FAIL'} ${result.kind} "${result.command}" — ` +
        `${result.metrics.llmRounds} llm rounds, ${result.metrics.attemptedTools} attempted / ${result.metrics.executedTools} executed tools, ` +
        `${result.metrics.repeatedActions} repeated${runs}` +
        (result.failureReason ? ` — ${result.failureReason}` : ''),
    )
  })
}
