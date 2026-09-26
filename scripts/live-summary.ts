#!/usr/bin/env node
// The #233 cross-pass summary entry point (`pnpm live:summary`): reads N
// JSON reports that `live:report --format=json` wrote and writes one compact
// summary of what the Passes say together. Node runs this .ts directly via
// type stripping (Node ≥ 22.18), so every runtime import on its graph
// carries a .ts extension.
//
// It reads reports and nothing else. No Electron, no model, no browser, no
// network, no capture sets, no grades, no key module, and no discovery:
// every input is an explicit path, and the output is written once. What it
// cannot check it refuses to merge — inputs that differ in anything the
// protocol fixes stop here with the differing values named.
//
// Usage:
//   pnpm live:summary --reports=<a.json>,<b.json>[,…] --out=<summary.md|json> [--format=markdown|json] [--allow-differs=routing]
//
// `--allow-differs=routing` pools Passes whose routing differs — the
// Decision Model experiment's arms (#279) — and says so in the summary's
// provenance; every other fixed field is still refused.
//
// A summary over failed hunts is a finding, not a tool error. Only
// unreadable, mismatched or too few inputs fail.

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { parseAllowDiffers } from '../e2e/live/allowedDifference.ts'
import { redactedMessage, type Validation } from '../e2e/live/artifacts.ts'
import { buildLiveSummary, formatLiveSummary, parseLiveReportForSummary, type LiveSummaryInput } from '../e2e/live/summary.ts'

const FLAGS = ['reports', 'out', 'format', 'allow-differs'] as const

class UsageError extends Error {}

/** Every message the CLI prints goes through here: safe text, one line, no payloads. */
function fail(message: string): never {
  process.stderr.write(`live:summary: ${message}\n`)
  process.exit(1)
}

function failWith(what: string, errors: readonly string[]): never {
  process.stderr.write(`live:summary: ${what}\n`)
  for (const error of errors) process.stderr.write(`  - ${error}\n`)
  process.exit(1)
}

function parseArgv(argv: readonly string[]): Map<string, string> {
  const positional = argv.filter((argument) => !argument.startsWith('--'))
  if (positional.length > 0) throw new UsageError(`live:summary takes no command, got ${positional.join(', ')}`)
  const flags = new Map<string, string>()
  for (const argument of argv) {
    const separator = argument.indexOf('=')
    if (separator === -1) throw new UsageError(`option "${argument}" needs a value, as --name=value`)
    const name = argument.slice(2, separator)
    const value = argument.slice(separator + 1)
    if (!(FLAGS as readonly string[]).includes(name)) {
      throw new UsageError(`live:summary does not take --${name} (it takes ${FLAGS.map((flag) => `--${flag}`).join(', ')})`)
    }
    if (flags.has(name)) throw new UsageError(`--${name} was given more than once`)
    if (value === '') throw new UsageError(`--${name} was given an empty value`)
    flags.set(name, value)
  }
  return flags
}

function required(flags: Map<string, string>, name: string): string {
  const value = flags.get(name)
  if (value === undefined) fail(`--${name} is required`)
  return value
}

/** Paths are printed relative to the working directory: a summary is shared, a home directory is not. */
function display(path: string): string {
  const relative = resolve(path).startsWith(`${process.cwd()}/`) ? resolve(path).slice(process.cwd().length + 1) : path
  return isAbsolute(relative) ? basename(relative) : relative
}

/**
 * How an input is named in the summary's provenance: relative to the
 * working directory when it lies inside it, else exactly as it was given.
 * Never a bare basename — two inputs in two directories must stay apart in
 * a record that outlives the command.
 */
function named(path: string): string {
  const fromCwd = relative(process.cwd(), resolve(path))
  return fromCwd !== '' && !fromCwd.startsWith('..') && !isAbsolute(fromCwd) ? fromCwd : path
}

/** Read and parse one JSON input. A parse failure names the file, never its contents. */
function readJson(path: string, what: string): unknown {
  if (!existsSync(path)) fail(`the ${what} does not exist at ${display(path)}`)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    fail(`the ${what} at ${display(path)} could not be read: ${redactedMessage(error)}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    // Not echoing the parser's excerpt: an unreadable file may be anything.
    fail(`the ${what} at ${display(path)} is not valid JSON`)
  }
}

/**
 * Where a not-yet-existing output would actually land, with its directory
 * resolved through any symlinks — so an alias to an input is caught before
 * anything is written.
 */
function resolvedTarget(path: string): string {
  const directory = dirname(resolve(path))
  const real = existsSync(directory) ? realpathSync(directory) : directory
  return join(real, basename(path))
}

/** Refuse an output that would land on an input or an existing file, before any write. */
function assertSafeOutput(outPath: string, protectedPaths: readonly string[]): void {
  if (existsSync(outPath)) {
    fail(`refusing to overwrite ${display(outPath)} — summaries, like reports, are written once, never over`)
  }
  const target = resolvedTarget(outPath)
  for (const candidate of protectedPaths) {
    if (!existsSync(candidate)) continue
    if (realpathSync(candidate) === target) {
      fail(`refusing to write over ${display(candidate)}, which this command reads (the output path resolves to the same file)`)
    }
  }
}

function writeOut(outPath: string, body: string, protectedPaths: readonly string[]): void {
  assertSafeOutput(outPath, protectedPaths)
  const directory = dirname(resolve(outPath))
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
  writeFileSync(outPath, body)
}

function unwrap<T>(result: Validation<T>, what: string): T {
  if (!result.ok) failWith(`the ${what} is not usable:`, result.errors)
  return result.value
}

let flags: Map<string, string>
try {
  flags = parseArgv(process.argv.slice(2))
} catch (error) {
  if (error instanceof UsageError) fail(error.message)
  throw error
}

const reportPaths = required(flags, 'reports')
  .split(',')
  .map((path) => path.trim())
  .filter((path) => path !== '')
const outPath = required(flags, 'out')
const format = flags.get('format') ?? 'markdown'
if (format !== 'markdown' && format !== 'json') fail(`--format must be markdown or json (got "${format}")`)
const allowDiffersFlag = flags.get('allow-differs')
const allowDiffers = allowDiffersFlag === undefined ? undefined : unwrap(parseAllowDiffers(allowDiffersFlag), '--allow-differs value')

const inputs: LiveSummaryInput[] = reportPaths.map((path) => ({
  path: named(path),
  report: unwrap(parseLiveReportForSummary(readJson(path, 'report'), display(path)), `report at ${display(path)}`),
}))

const summary = unwrap(buildLiveSummary(inputs, new Date().toISOString(), { allowDiffers }), 'set of reports')
const body = format === 'json' ? `${JSON.stringify(summary, null, 2)}\n` : formatLiveSummary(summary)
writeOut(outPath, body, reportPaths)

const { initial, revisedObjective, bothStep } = summary.populations
process.stdout.write(
  `written: ${display(outPath)}\n` +
    `${summary.passes} passes: ${summary.provenance.passes.map((pass) => pass.setId).join(', ')}\n` +
    `initial hunts verified ${initial.verifiedSuccess}/${initial.scheduled}` +
    (revisedObjective.scheduled > 0 ? `, follow-ups ${revisedObjective.verifiedSuccess}/${revisedObjective.scheduled}, both steps ${bothStep.verifiedSuccess}/${bothStep.scheduled}` : '') +
    ` over all passes\n${summary.warnings.length} data-quality warning(s), ${summary.anomalies.length} protocol anomaly(ies) carried\n`,
)

export {}
