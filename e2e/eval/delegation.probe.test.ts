import { afterAll, beforeAll, expect, it } from 'vitest'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reasoningEffortLabel } from './evaluator'
import { startEvaluator, type Evaluator, type ScenarioResult } from './evaluator'
import { delegationScenarios } from './delegationScenarios'
import { summarizeDelegation, workersNeededForCeiling } from './delegationProbe'

// The delegation probe (#163) — opt-in, real-model, and deliberately NOT
// part of `pnpm test:eval`:
//
//   pnpm test:delegation                                        # scratch pass
//   BINGBONG_DELEGATION_REPORT=e2e/eval/delegation/pass-<n>.json pnpm test:delegation
//   pnpm delegation:summary                                     # pool every pass
//
// It has its own vitest config so the release capture (#132) keeps its
// cost, its scenario set, and its pooled statistics exactly as captured —
// its artifacts never land under e2e/eval/pools/, and `eval:accept` refuses
// any pool carrying an id the release corpus does not declare.
//
// What fails this suite is the same thing that fails the release capture:
// broken measurement (missing routing, a scripted model, a run that never
// happened). Whether the orchestrator delegated is recorded, never
// asserted — the whole point is to find out.

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

/**
 * The ceiling #161 would need to call a worker's no-Progress accounting
 * "not too tight" from an empty column — reported so a pass says how much
 * further the probe has to run before its silence means anything.
 */
const TARGET_NO_PROGRESS_CEILING = 0.1

let evaluator: Evaluator
const results: ScenarioResult[] = []

beforeAll(async () => {
  evaluator = await startEvaluator({
    reportPath: process.env.BINGBONG_DELEGATION_REPORT ?? join(repoRoot, 'e2e', 'eval', 'delegation', 'probe.json'),
    // Capture artifacts are immutable (#132). A probe pass belongs in the
    // probe's own directory under its own env var — never in the release
    // pools, which `pnpm eval:accept` would then refuse anyway.
    freshArtifactHint:
      'point BINGBONG_DELEGATION_REPORT at a new pass artifact (e2e/eval/delegation/pass-<n>.json), or delete the scratch probe.json',
  })
})

afterAll(async () => {
  if (!evaluator) return
  try {
    const report = await evaluator.finish()
    // Same real-model proof the release capture demands: a scripted model
    // anywhere would make every delegation reading below meaningless.
    expect(report.modelWitness.scriptedEntries).toEqual([])
    expect(report.modelWitness.orchestratorModel).toBe(
      report.routing.orchestrator.configured ? report.routing.orchestrator.model : null,
    )
    expect(report.modelWitness.orchestratorRequests).toBeGreaterThan(0)

    const summary = summarizeDelegation(results)
    const stops = Object.entries(summary.workerStops)
      .map(([stop, count]) => `${stop} ${count}`)
      .join('  ')
    const reading =
      summary.noProgress.kind === 'none'
        ? 'no worker ran — nothing to read'
        : summary.noProgress.kind === 'unseen'
          ? `unseen in ${summary.noProgress.workers} workers — rate below ${(summary.noProgress.rateCeiling * 100).toFixed(1)}% (rule of three); ` +
            `${workersNeededForCeiling(TARGET_NO_PROGRESS_CEILING)} workers bound it under ${TARGET_NO_PROGRESS_CEILING * 100}%`
          : `${summary.noProgress.count} of ${summary.noProgress.workers} workers (${(summary.noProgress.rate * 100).toFixed(1)}%)`
    console.log(
      [
        '',
        `delegation probe: ${summary.delegatingScenarios}/${summary.scenarios.length} scenarios delegated`,
        `  spawn_agent    ${summary.spawns.attempted} attempted, ${summary.spawns.accepted} accepted, ` +
          `${summary.spawns.refusedOffTier} refused off-tier, ${summary.spawns.refusedOther} refused otherwise`,
        `  worker stops   ${stops === '' ? 'none' : stops}`,
        `  no_progress    ${reading}`,
        `  model: ${report.modelWitness.orchestratorModel} (${report.modelWitness.orchestratorRequests} rounds witnessed)`,
        `  reasoning effort: ${reasoningEffortLabel(report.modelWitness).replace('effort:', '')}`,
        '',
      ].join('\n'),
    )
  } finally {
    await evaluator.quit()
  }
})

for (const scenario of delegationScenarios()) {
  it(`probes delegation on ${scenario.id}`, { timeout: 35 * 60_000 }, async () => {
    const result = await evaluator.runScenario(scenario)
    results.push(result)
    const row = summarizeDelegation([result]).scenarios[0]!
    console.log(
      `[delegation] ${result.success ? 'PASS' : 'FAIL'} ${result.id} — tier ${row.effortTier}, ` +
        `${row.spawns.attempted} spawn attempts (${row.spawns.accepted} accepted, ${row.spawns.refusedOffTier} off-tier), ` +
        `workers ${JSON.stringify(row.workerStops)}, ${result.metrics.llmRounds} llm rounds` +
        (result.failureReason ? ` — ${result.failureReason}` : ''),
    )
  })
}
