#!/usr/bin/env node
// The #163 delegation probe's pooling entry point (`pnpm delegation:summary`):
// reads every finalized probe capture in a directory and prints one
// delegation reading over all of them. Node runs this .ts directly via type
// stripping (Node ≥ 22.18), so .ts on the runtime import graph.
//
// Unlike the release decision this pools whatever is there — worker
// observations are what accumulate pass over pass, and the report says how
// many more are needed before an empty `no_progress` column means anything.
// It gates nothing and writes nothing: a delegation reading is a diagnostic
// for #161, never a release input.
//
// Usage:
//   BINGBONG_DELEGATION_REPORT=e2e/eval/delegation/pass-1.json pnpm test:delegation   # ×N
//   pnpm delegation:summary
//   pnpm delegation:summary --dir=<dir> --ceiling=0.05

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { summarizeDelegation, workersNeededForCeiling } from '../e2e/eval/delegationProbe.ts'
import type { EvalReport, ScenarioResult } from '../e2e/eval/evaluator'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

function flagValue(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

const dir = flagValue('dir') ?? join(repoRoot, 'e2e', 'eval', 'delegation')
const ceiling = Number(flagValue('ceiling') ?? '0.1')

// The scratch artifact `pnpm test:delegation` writes without
// BINGBONG_DELEGATION_REPORT is skipped on purpose: it is gitignored, it
// is overwritten pass to pass, and its scenarios usually duplicate a named
// pass's. Pooling it would double-count workers — and worker count is the
// denominator of the rule-of-three bound below.
const SCRATCH_CAPTURE = 'probe.json'

let entries: string[]
try {
  entries = readdirSync(dir)
    .filter((entry) => entry.endsWith('.json') && entry !== SCRATCH_CAPTURE)
    .sort()
} catch (error) {
  throw new Error(`no delegation capture directory at ${dir}: ${String(error)} — run pnpm test:delegation first`)
}
if (entries.length === 0) {
  throw new Error(
    `no named delegation captures in ${dir} (the scratch ${SCRATCH_CAPTURE} is never pooled) — ` +
      'run BINGBONG_DELEGATION_REPORT=e2e/eval/delegation/pass-<n>.json pnpm test:delegation first',
  )
}

const captures: { file: string; report: EvalReport }[] = entries.map((entry) => {
  const path = join(dir, entry)
  const report = JSON.parse(readFileSync(path, 'utf8')) as EvalReport
  if (!Array.isArray(report.scenarios) || report.aggregate === undefined) {
    throw new Error(`${path} is not a finalized capture — let the probe run to completion`)
  }
  return { file: entry, report }
})

const results: ScenarioResult[] = captures.flatMap((capture) => capture.report.scenarios)
const summary = summarizeDelegation(results)

const stops = Object.entries(summary.workerStops)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([stop, count]) => `${stop} ${count}`)
  .join('  ')

const lines = [
  `delegation probe — ${captures.length} capture(s) from ${dir}`,
  ...captures.map((capture) => `  ${capture.file}  ${capture.report.gitCommit.slice(0, 7)}  ${capture.report.capturedAt}`),
  '',
  `scenarios that delegated : ${summary.delegatingScenarios}/${summary.scenarios.length}`,
  `spawn_agent              : ${summary.spawns.attempted} attempted, ${summary.spawns.accepted} accepted, ` +
    `${summary.spawns.refusedOffTier} refused off-tier, ${summary.spawns.refusedOther} refused otherwise` +
    (summary.spawns.unanswered > 0 ? `, ${summary.spawns.unanswered} left unanswered` : ''),
  `workers observed         : ${summary.workersObserved} ` +
    `(${summary.selfFinalizedWorkers} reached a cause of their own — the reading below rests on those)`,
  `worker stop causes       : ${stops === '' ? 'none' : stops}`,
  '',
]

if (summary.noProgress.kind === 'none') {
  lines.push(
    summary.workersObserved === 0
      ? 'no_progress: unreadable — no worker ran, so the column is empty for want of a subject, not for want of the cause.'
      : `no_progress: unreadable — all ${summary.workersObserved} worker(s) were cancelled or failed, so none reached a cause of its own.`,
    'This is the state #163 opened on. Vary the probe objectives until spawns are accepted and workers finish.',
  )
} else if (summary.noProgress.kind === 'unseen') {
  const needed = workersNeededForCeiling(ceiling)
  lines.push(
    `no_progress: unseen in ${summary.noProgress.workers} worker(s). By the rule of three its true rate is ` +
      `below ${(summary.noProgress.rateCeiling * 100).toFixed(1)}% at ~95% confidence.`,
    needed > summary.noProgress.workers
      ? `To bound it under ${(ceiling * 100).toFixed(1)}%, ${needed} workers are needed — ${needed - summary.noProgress.workers} more.`
      : `That already clears the ${(ceiling * 100).toFixed(1)}% bar (${needed} workers required).`,
  )
} else {
  lines.push(
    `no_progress: ${summary.noProgress.count} of ${summary.noProgress.workers} worker(s) — ` +
      `${(summary.noProgress.rate * 100).toFixed(1)}% observed. #161 has a subject.`,
  )
}

lines.push('', 'per scenario observation:')
for (const row of summary.scenarios) {
  lines.push(
    `  ${row.id.padEnd(30)} ${row.success ? 'PASS' : 'FAIL'}  tier ${row.effortTier.padEnd(14)} ` +
      `spawns ${row.spawns.attempted}/${row.spawns.accepted} accepted` +
      (row.spawns.refusedOffTier > 0 ? ` (${row.spawns.refusedOffTier} off-tier)` : '') +
      `  workers ${JSON.stringify(row.workerStops)}`,
  )
}

console.log(lines.join('\n'))
