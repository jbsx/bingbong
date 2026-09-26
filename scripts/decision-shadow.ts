#!/usr/bin/env node
// The Decision Model shadow replay (#275, ADR 0068), `pnpm decision:shadow`:
// walks the Run Traces of named live capture sets, rebuilds each seam's
// state from the tool results the orchestrator saw, asks the Decision Model,
// and writes agreement with what the model did next — per seam, by
// confidence decile, with latency. Node runs this .ts directly via type
// stripping, so every runtime import on its graph carries a .ts extension.
//
// It spends real Decision Model budget (one request per sample) and reads
// no other network. The key comes from the decision role's routing, read
// from --env-file (default ./.env) under the process env, as the app reads it.
//
// Usage:
//   pnpm decision:shadow --sets=fix-265-267,fix-270 --roots=<artifacts dir>[,<dir>…] --out=<report.json> [--env-file=<.env>] [--concurrency=4] [--dry-run]
//
// A capture directory is `<root>/<set>-<pass>--<hunt>`; its `logs/run-trace-*.jsonl`
// files are read in name order. --dry-run counts samples and asks nothing.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { layerEnv, parseDotEnv } from '../src/core/settings/dotEnv.ts'
import { resolveDecisionRouting, type DecisionSeam } from '../src/core/agent/modelRouting.ts'
import { DECISION_THRESHOLDS } from '../src/core/ports/decisionModel.ts'
import { createJevDecisionModel, DECISION_TIMEOUT_MS } from '../src/main/decision/createJevDecisionModel.ts'
import {
  askSamples,
  readShadowRuns,
  shadowSamples,
  SHADOW_LIMITS,
  summarizeSeam,
  type ShadowTraceLine,
} from '../e2e/eval/jev/shadow.ts'

const FLAGS = ['sets', 'roots', 'out', 'env-file', 'concurrency', 'dry-run'] as const
const SEAMS: readonly DecisionSeam[] = ['passage', 'result', 'tier']

function fail(message: string): never {
  process.stderr.write(`decision:shadow: ${message}\n`)
  process.exit(1)
}

function parseArgv(argv: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>()
  for (const argument of argv) {
    if (!argument.startsWith('--')) fail(`takes no positional arguments, got ${argument}`)
    const separator = argument.indexOf('=')
    const name = separator === -1 ? argument.slice(2) : argument.slice(2, separator)
    const value = separator === -1 ? 'true' : argument.slice(separator + 1)
    if (!(FLAGS as readonly string[]).includes(name)) fail(`does not take --${name} (it takes ${FLAGS.map((flag) => `--${flag}`).join(', ')})`)
    if (flags.has(name)) fail(`--${name} was given more than once`)
    flags.set(name, value)
  }
  return flags
}

function list(value: string | undefined, name: string): string[] {
  const items = (value ?? '').split(',').map((item) => item.trim()).filter((item) => item !== '')
  if (items.length === 0) fail(`--${name} is required`)
  return items
}

function parseJsonl(text: string): ShadowTraceLine[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as ShadowTraceLine)
}

/** Every capture directory of the named sets under the roots, by name. */
function captureDirs(roots: readonly string[], sets: readonly string[]): Map<string, string[]> {
  const bySet = new Map<string, string[]>(sets.map((set) => [set, []]))
  for (const root of roots) {
    if (!existsSync(root)) fail(`root ${root} does not exist`)
    for (const name of readdirSync(root).sort()) {
      const set = sets.find((wanted) => new RegExp(`^${wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+--`).test(name))
      if (set !== undefined) bySet.get(set)?.push(join(root, name))
    }
  }
  for (const [set, dirs] of bySet) if (dirs.length === 0) fail(`no capture of set ${set} under ${roots.join(', ')}`)
  return bySet
}

function traceLines(dir: string): ShadowTraceLine[] {
  const logs = join(dir, 'logs')
  if (!existsSync(logs)) return []
  return readdirSync(logs)
    .filter((name) => name.startsWith('run-trace-') && name.endsWith('.jsonl'))
    .sort()
    .flatMap((name) => parseJsonl(readFileSync(join(logs, name), 'utf8')))
}

async function main(): Promise<void> {
  const flags = parseArgv(process.argv.slice(2))
  const sets = list(flags.get('sets'), 'sets')
  const roots = list(flags.get('roots'), 'roots').map((root) => resolve(root))
  const dryRun = flags.get('dry-run') === 'true'
  const out = dryRun ? undefined : flags.get('out') ?? fail('--out is required unless --dry-run')
  const concurrency = Number(flags.get('concurrency') ?? '4')
  if (!Number.isInteger(concurrency) || concurrency < 1) fail('--concurrency must be a positive integer')

  const dirsBySet = captureDirs(roots, sets)
  const runs = [...dirsBySet.values()].flat().flatMap((dir) => readShadowRuns(dir.split('/').at(-1) ?? dir, traceLines(dir)))
  const samples = shadowSamples(runs)
  const counts = Object.fromEntries(SEAMS.map((seam) => [seam, samples.filter((sample) => sample.seam === seam).length]))
  process.stderr.write(`decision:shadow: ${[...dirsBySet.values()].flat().length} captures, ${runs.length} runs, samples ${JSON.stringify(counts)}\n`)
  if (dryRun) return

  const envFile = resolve(flags.get('env-file') ?? '.env')
  const fileValues = existsSync(envFile) ? parseDotEnv(readFileSync(envFile, 'utf8')) : {}
  const routing = resolveDecisionRouting(layerEnv(fileValues, process.env))
  if (!routing.configured) fail(`the decision role is not configured (${routing.reason}); looked in ${envFile} and the process env`)
  const model = createJevDecisionModel(routing.endpoint)

  const rows = await askSamples(model, samples, concurrency, (_row, done) => {
    if (done % 25 === 0 || done === samples.length) process.stderr.write(`decision:shadow: ${done}/${samples.length}\n`)
  })
  const report = {
    kind: 'decision_shadow',
    issue: 275,
    generatedAt: new Date().toISOString(),
    model: routing.endpoint.model,
    timeoutMs: DECISION_TIMEOUT_MS,
    thresholds: DECISION_THRESHOLDS,
    sets: Object.fromEntries([...dirsBySet].map(([set, dirs]) => [set, dirs.length])),
    runs: runs.length,
    limits: SHADOW_LIMITS,
    seams: Object.fromEntries(SEAMS.map((seam) => [seam, summarizeSeam(rows.filter((row) => row.seam === seam), DECISION_THRESHOLDS)])),
    rows,
  }
  const outPath = resolve(out as string)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)
  process.stderr.write(`decision:shadow: wrote ${outPath}\n`)
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)))
