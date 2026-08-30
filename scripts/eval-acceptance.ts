#!/usr/bin/env node
// The #128 release-decision entry point (`pnpm eval:accept`): reads the
// candidate real-model report (e2e/eval/report.json, from `pnpm test:eval`)
// and the frozen baseline (e2e/eval/baseline.json, #109), runs the #108
// release-acceptance gates over both, writes e2e/eval/decision.json, and
// prints the one-screen decision. Exit code 0 is accept, 1 reject — a gate
// can fail honestly; only broken input (a missing or malformed report)
// throws. Node runs this .ts directly via type stripping (Node ≥ 22.18),
// so .ts-extension imports here and on the runtime import graph.
//
// Usage:
//   pnpm test:eval                          # capture e2e/eval/report.json
//   pnpm test:e2e                           # mandatory regressions
//   pnpm eval:accept --regressions=passed   # decide (also: failed | not-run)

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decideRelease, formatDecision, type RegressionsInput } from '../e2e/eval/acceptance.ts'
import type { EvalReport } from '../e2e/eval/evaluator.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

function readReport(path: string, role: string): EvalReport {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${role} report is missing or not JSON at ${path}: ${String(error)}`)
  }
  const report = parsed as EvalReport
  if (!Array.isArray(report.scenarios) || report.scenarios.length === 0 || report.aggregate === undefined) {
    throw new Error(`${role} report at ${path} carries no finalized scenarios — capture it before deciding`)
  }
  return report
}

const positional = process.argv.slice(2).filter((argument) => !argument.startsWith('--'))
const regressionsArgument = process.argv.slice(2).find((argument) => argument.startsWith('--regressions='))
const regressions = (regressionsArgument?.slice('--regressions='.length) ?? 'not-run') as RegressionsInput
if (!['passed', 'failed', 'not-run'].includes(regressions)) {
  throw new Error(`--regressions must be passed, failed, or not-run (got "${regressions}")`)
}

const reportPath = positional[0] ?? join(repoRoot, 'e2e', 'eval', 'report.json')
const baselinePath = positional[1] ?? join(repoRoot, 'e2e', 'eval', 'baseline.json')

const decision = decideRelease(readReport(reportPath, 'candidate'), readReport(baselinePath, 'baseline'), {
  regressions,
})
const decisionPath = join(repoRoot, 'e2e', 'eval', 'decision.json')
writeFileSync(decisionPath, `${JSON.stringify(decision, null, 2)}\n`)
console.log(formatDecision(decision))
console.log(`\nwritten: ${decisionPath}`)
process.exitCode = decision.decision === 'accept' ? 0 : 1
