#!/usr/bin/env node
// The #279 comparison entry point (`pnpm eval:compare`): reads two
// directories of release-evaluator captures — three finalized reports each,
// all from one commit — compares them on the corpus both cover, prints the
// #274 gate in its order and writes the comparison as JSON and Markdown.
// Exit code 0 whatever the gate says — a comparison reports, the #274
// decision comment decides; only broken input (a missing or malformed
// capture, unequal pools, two commits, arms that differ in anything but the
// decision role and the seam list) fails.
//
// Node runs this .ts directly via type stripping (Node ≥ 22.18), so .ts
// imports here and on the runtime import graph.
//
// Usage:
//   BINGBONG_EVAL_REPORT=e2e/eval/jev/on/pass-<n>-<commit8>.json pnpm test:eval    # ×3, role configured
//   TYPESAFE_API_KEY= BINGBONG_DECISION_API_KEY= \
//   BINGBONG_EVAL_REPORT=e2e/eval/jev/off/pass-<n>-<commit8>.json pnpm test:eval   # ×3, role unconfigured
//   pnpm eval:compare --a=e2e/eval/jev/off --b=e2e/eval/jev/on [--out=<path prefix>]
//
// Writes <prefix>.json and <prefix>.md; the prefix defaults to
// e2e/eval/jev/compare-<YYYY-MM-DD>. Neither is ever written over.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { comparePools, formatComparison } from '../e2e/eval/compare.ts'
import type { EvalReport } from '../e2e/eval/evaluator.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const FLAGS = ['a', 'b', 'out'] as const

function fail(message: string): never {
  process.stderr.write(`eval:compare: ${message}\n`)
  process.exit(1)
}

const flags = new Map<string, string>()
for (const argument of process.argv.slice(2)) {
  const match = /^--([a-z]+)=(.+)$/.exec(argument)
  if (match === null) fail(`options are --name=value (got "${argument}")`)
  const [, name, value] = match
  if (!(FLAGS as readonly string[]).includes(name!)) fail(`eval:compare does not take --${name} (it takes ${FLAGS.map((flag) => `--${flag}`).join(', ')})`)
  if (flags.has(name!)) fail(`--${name} was given more than once`)
  flags.set(name!, value!)
}

function readPoolDir(dir: string, side: string): EvalReport[] {
  let entries: string[]
  try {
    entries = readdirSync(dir).filter((entry) => entry.endsWith('.json')).sort()
  } catch {
    fail(`the ${side} pool directory is missing at ${dir}`)
  }
  return entries.map((entry) => {
    const path = join(dir, entry)
    let report: EvalReport
    try {
      report = JSON.parse(readFileSync(path, 'utf8')) as EvalReport
    } catch {
      fail(`the ${side} capture at ${path} is not JSON`)
    }
    if (!Array.isArray(report.scenarios) || report.scenarios.length === 0 || report.aggregate === undefined) {
      fail(`the ${side} capture at ${path} carries no finalized scenarios — capture it to completion before comparing`)
    }
    return report
  })
}

const aDir = flags.get('a') ?? fail('--a=<dir> is required')
const bDir = flags.get('b') ?? fail('--b=<dir> is required')
const comparedAt = new Date()
const prefix = resolve(flags.get('out') ?? join(repoRoot, 'e2e', 'eval', 'jev', `compare-${comparedAt.toISOString().slice(0, 10)}`))
const outputs = { json: `${prefix}.json`, md: `${prefix}.md` }
for (const path of Object.values(outputs)) {
  if (existsSync(path)) fail(`refusing to overwrite ${relative(process.cwd(), path)} — a comparison is written once; pass --out for another`)
}

let comparison: ReturnType<typeof comparePools>
try {
  comparison = comparePools(
    { source: relative(process.cwd(), resolve(aDir)) || '.', reports: readPoolDir(aDir, 'a') },
    { source: relative(process.cwd(), resolve(bDir)) || '.', reports: readPoolDir(bDir, 'b') },
    comparedAt,
  )
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

const markdown = formatComparison(comparison)
mkdirSync(dirname(prefix), { recursive: true })
writeFileSync(outputs.json, `${JSON.stringify(comparison, null, 2)}\n`)
writeFileSync(outputs.md, markdown)
process.stdout.write(`${markdown}\nwritten: ${relative(process.cwd(), outputs.json)}, ${relative(process.cwd(), outputs.md)}\n`)
