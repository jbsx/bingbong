#!/usr/bin/env node
// The #128/#132 release-decision entry point (`pnpm eval:accept`): reads
// the pooled real-model captures — three finalized reports per side —
// runs the #108 release-acceptance gates over both pools, writes
// e2e/eval/decision.json, and prints the one-screen decision. Exit code
// 0 is accept, 1 reject — a gate can fail honestly; only broken input (a
// missing or malformed capture, an incomplete or mismatched pool) throws.
// Node runs this .ts directly via type stripping (Node ≥ 22.18), so .ts
// imports here and on the runtime import graph.
//
// Pool dirs default to e2e/eval/pools/{candidate,baseline}; each holds
// one finalized report per capture (convention: pass-<n>-<commit8>.json),
// produced by pointing the capture suite at its own artifact so no pass
// ever overwrites another:
//
//   BINGBONG_EVAL_REPORT=e2e/eval/pools/candidate/pass-1-<commit8>.json pnpm test:eval
//
// The baseline pool is captured the same way from the pinned pre-#114
// tree (2343a3c worktree + eval overlay, see #130/#132).
//
// Usage:
//   pnpm test:eval                        # ×3, one artifact per pass, per side
//   pnpm test:e2e                         # mandatory regressions
//   pnpm eval:accept --regressions=passed # decide (also: failed | not-run)
//   pnpm eval:accept --regressions=passed --baseline=<dir> --candidate=<dir>

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decideRelease, formatDecision, POOL_SIZE, type RegressionsInput } from '../e2e/eval/acceptance.ts'
import type { EvalReport } from '../e2e/eval/evaluator.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

function readPoolDir(dir: string, role: string): EvalReport[] {
  let entries: string[]
  try {
    entries = readdirSync(dir).filter((entry) => entry.endsWith('.json')).sort()
  } catch (error) {
    throw new Error(`${role} pool directory is missing at ${dir}: ${String(error)}`)
  }
  if (entries.length !== POOL_SIZE) {
    throw new Error(`${role} pool at ${dir} holds ${entries.length} capture(s) (${entries.join(', ')}) — a decision needs exactly ${POOL_SIZE}`)
  }
  return entries.map((entry) => {
    const path = join(dir, entry)
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      throw new Error(`${role} capture is not JSON at ${path}: ${String(error)}`)
    }
    const report = parsed as EvalReport
    // Finality is re-checked here (with the file path) even though
    // buildPool owns the invariant — the script's copy names the artifact
    // on disk, the pool's copy names the capture index; keep both in sync.
    if (!Array.isArray(report.scenarios) || report.scenarios.length === 0 || report.aggregate === undefined) {
      throw new Error(`${role} capture at ${path} carries no finalized scenarios — capture it to completion before deciding`)
    }
    return report
  })
}

const regressionsArgument = process.argv.slice(2).find((argument) => argument.startsWith('--regressions='))
const regressions = (regressionsArgument?.slice('--regressions='.length) ?? 'not-run') as RegressionsInput
if (!['passed', 'failed', 'not-run'].includes(regressions)) {
  throw new Error(`--regressions must be passed, failed, or not-run (got "${regressions}")`)
}

const flagValue = (name: string): string | undefined =>
  process.argv.slice(2).find((argument) => argument.startsWith(`--${name}=`))?.slice(`--${name}=`.length)

const candidateDir = flagValue('candidate') ?? join(repoRoot, 'e2e', 'eval', 'pools', 'candidate')
const baselineDir = flagValue('baseline') ?? join(repoRoot, 'e2e', 'eval', 'pools', 'baseline')

const decision = decideRelease(readPoolDir(candidateDir, 'candidate'), readPoolDir(baselineDir, 'baseline'), {
  regressions,
})
const decisionPath = join(repoRoot, 'e2e', 'eval', 'decision.json')
writeFileSync(decisionPath, `${JSON.stringify(decision, null, 2)}\n`)
console.log(formatDecision(decision))
console.log(`\nwritten: ${decisionPath}`)
process.exitCode = decision.decision === 'accept' ? 0 : 1
