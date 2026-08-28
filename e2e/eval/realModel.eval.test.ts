import { afterAll, beforeAll, expect, it } from 'vitest'
import { startEvaluator, type Evaluator } from './evaluator'
import { evalScenarios } from './scenarios'

// The real-model evaluation suite (#109) — opt-in by design:
//
//   pnpm test:eval
//   BINGBONG_EVAL_REPORT=e2e/eval/baseline.json pnpm test:eval   # freeze a baseline
//
// It is deliberately outside `pnpm test:e2e`'s include pattern: it spends
// real model budget against the developer's production routing, so it runs
// only when asked, always under Xvfb like every Electron suite here.
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
    console.log(
      [
        '',
        `real-model evaluation: ${agg.objectiveSuccesses}/${agg.scenarioCount} scenarios met their objective`,
        `  llm rounds     median ${agg.llmRounds.median}  p95 ${agg.llmRounds.p95}`,
        `  elapsed      ${Math.round(agg.elapsedMs.median / 1000)}s median  ${Math.round(agg.elapsedMs.p95 / 1000)}s p95`,
        `  raw-limit failures: ${agg.rawLimitFailures}   timed out: ${agg.timedOutScenarios}`,
        `  model: ${report.modelWitness.orchestratorModel} (${report.modelWitness.orchestratorRequests} rounds witnessed)`,
        '',
      ].join('\n'),
    )
  } finally {
    await evaluator.quit()
  }
})

for (const scenario of evalScenarios()) {
  it(`records the ${scenario.kind} scenario (${scenario.id})`, { timeout: 20 * 60_000 }, async () => {
    const result = await evaluator.runScenario(scenario)
    // Success, failure, and timeout are all recorded data — logged, not asserted.
    console.log(
      `[eval] ${result.success ? 'PASS' : 'FAIL'} ${result.kind} "${result.command}" — ` +
        `${result.metrics.llmRounds} llm rounds, ${result.metrics.attemptedTools} attempted / ${result.metrics.executedTools} executed tools, ` +
        `${result.metrics.repeatedActions} repeated` +
        (result.failureReason ? ` — ${result.failureReason}` : ''),
    )
  })
}
