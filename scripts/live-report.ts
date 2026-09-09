#!/usr/bin/env node
// The #226 offline reporting entry point (`pnpm live:report`): opens a
// review over a retained capture set, and projects that review into the
// compact report. Node runs this .ts directly via type stripping (Node ≥
// 22.18), so every runtime import on its graph carries a .ts extension.
//
// It reads evidence and nothing else. No Electron, no model, no browser,
// no network, no scheduler, and no automatic discovery of anything: every
// input is an explicit path, because a reporting tool that goes looking
// for captures is a reporting tool that will one day find the wrong ones.
// Checking the sources against the key is the reviewer's job, done
// elsewhere; this command cannot fetch a page and never tries.
//
// Usage:
//   pnpm live:report init-grades --capture=<capture-set.json> --keys=<key-manifest.json> --out=<pending-grades.json>
//   pnpm live:report --capture=<capture-set.json> --keys=<key-manifest.json> --grades=<reviewed-grades.json> \
//                    [--format=markdown|json] [--pricing=<dated-prices.json>] [--out=<report.md>]
//
// A report over failed hunts or pending grades still succeeds — that is a
// finding, not a tool error. Only unreadable or mismatched input fails.

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { readCaptureSet, redactedMessage, type Validation } from '../e2e/live/artifacts.ts'
import { initializeLiveGrades, parseLiveGrades, parseLiveKeyManifest, type LiveGradingInputs } from '../e2e/live/grades.ts'
import { buildLiveReport, formatLiveReport, type LivePricingInput } from '../e2e/live/report.ts'
import type { LiveSessionCapture } from '../e2e/live/types.ts'

const COMMANDS = ['init-grades', 'report'] as const
type Command = (typeof COMMANDS)[number]

const FLAGS_BY_COMMAND: Readonly<Record<Command, readonly string[]>> = {
  'init-grades': ['capture', 'keys', 'out'],
  report: ['capture', 'keys', 'grades', 'pricing', 'format', 'out'],
}

class UsageError extends Error {}

/** Every message the CLI prints goes through here: safe text, one line, no payloads. */
function fail(message: string): never {
  process.stderr.write(`live:report: ${message}\n`)
  process.exit(1)
}

function failWith(what: string, errors: readonly string[]): never {
  process.stderr.write(`live:report: ${what}\n`)
  for (const error of errors) process.stderr.write(`  - ${error}\n`)
  process.exit(1)
}

function parseArgv(argv: readonly string[]): { command: Command; flags: Map<string, string> } {
  const positional = argv.filter((argument) => !argument.startsWith('--'))
  if (positional.length > 1) throw new UsageError(`expected at most one command, got ${positional.join(', ')}`)
  const named = positional[0] ?? 'report'
  if (!COMMANDS.includes(named as Command)) throw new UsageError(`unknown command "${named}" — expected ${COMMANDS.join(' or ')}`)
  const command = named as Command

  const flags = new Map<string, string>()
  for (const argument of argv.filter((candidate) => candidate.startsWith('--'))) {
    const separator = argument.indexOf('=')
    if (separator === -1) throw new UsageError(`option "${argument}" needs a value, as --name=value`)
    const name = argument.slice(2, separator)
    const value = argument.slice(separator + 1)
    if (!FLAGS_BY_COMMAND[command].includes(name)) {
      throw new UsageError(`"${command}" does not take --${name} (it takes ${FLAGS_BY_COMMAND[command].map((flag) => `--${flag}`).join(', ')})`)
    }
    if (flags.has(name)) throw new UsageError(`--${name} was given more than once`)
    if (value === '') throw new UsageError(`--${name} was given an empty value`)
    flags.set(name, value)
  }
  return { command, flags }
}

function required(flags: Map<string, string>, name: string): string {
  const value = flags.get(name)
  if (value === undefined) fail(`--${name} is required`)
  return value
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
    // Deliberately not echoing the parser's excerpt: these files carry
    // private key material and raw Answers.
    fail(`the ${what} at ${display(path)} is not valid JSON`)
  }
}

/** Paths are printed relative to the working directory: a report is shared, a home directory is not. */
function display(path: string): string {
  const relative = resolve(path).startsWith(`${process.cwd()}/`) ? resolve(path).slice(process.cwd().length + 1) : path
  return isAbsolute(relative) ? basename(relative) : relative
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

/**
 * Refuse an output that would land on an input, an existing file, or an
 * artifact a capture depends on. Validation happens before any write, and
 * nothing this command reads is ever a legal write target.
 */
function assertSafeOutput(outPath: string, protectedPaths: readonly string[]): void {
  if (existsSync(outPath)) {
    fail(`refusing to overwrite ${display(outPath)} — reports, grades and captures are written once, never over`)
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

let parsed: { command: Command; flags: Map<string, string> }
try {
  parsed = parseArgv(process.argv.slice(2))
} catch (error) {
  if (error instanceof UsageError) fail(error.message)
  throw error
}
const { command, flags } = parsed

const capturePath = required(flags, 'capture')
const keysPath = required(flags, 'keys')

if (!existsSync(capturePath)) fail(`the capture set does not exist at ${display(capturePath)}`)
const capture = unwrap(readCaptureSet(capturePath), 'capture set')
const sessionFailures = capture.sessions.filter((session) => !session.ok)
if (sessionFailures.length > 0) {
  failWith(
    'the capture set references Session captures that do not validate:',
    sessionFailures.flatMap((session) => (session.ok ? [] : session.errors)),
  )
}
const sessions = capture.sessions.map((session) => (session.ok ? session.value : null)).filter((session): session is LiveSessionCapture => session !== null)

const manifest = unwrap(parseLiveKeyManifest(readJson(keysPath, 'key manifest')), 'key manifest')

const captureDirectory = dirname(resolve(capturePath))
const protectedPaths = [
  capturePath,
  keysPath,
  ...(flags.get('grades') === undefined ? [] : [flags.get('grades')!]),
  ...(flags.get('pricing') === undefined ? [] : [flags.get('pricing')!]),
  ...capture.set.sessions.map((reference) => join(captureDirectory, reference.path)),
  ...sessions.flatMap((session) =>
    session.artifacts.map((artifact) => join(captureDirectory, session.captureId, artifact.path)),
  ),
]

const inputs: LiveGradingInputs = { set: capture.set, sessions, manifest }

if (command === 'init-grades') {
  const outPath = required(flags, 'out')
  const grades = initializeLiveGrades(inputs)
  writeOut(outPath, `${JSON.stringify(grades, null, 2)}\n`, protectedPaths)
  process.stdout.write(
    `opened ${grades.entries.length} pending grade(s) for capture set ${grades.setId} against key ${grades.keyVersion}\n` +
      `written: ${display(outPath)}\n` +
      'Every entry is pending. Nothing the app said about itself — a done outcome, a proposed completed Resolution — opens as a pass.\n',
  )
} else {
  const gradesPath = required(flags, 'grades')
  const format = flags.get('format') ?? 'markdown'
  if (format !== 'markdown' && format !== 'json') fail(`--format must be markdown or json (got "${format}")`)

  const grades = unwrap(parseLiveGrades(readJson(gradesPath, 'grades'), inputs), 'grades file')
  let pricing: LivePricingInput | undefined
  if (flags.get('pricing') !== undefined) {
    const raw = readJson(flags.get('pricing')!, 'price list')
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof (raw as LivePricingInput).source !== 'string' ||
      typeof (raw as LivePricingInput).dated !== 'string' ||
      typeof (raw as LivePricingInput).models !== 'object'
    ) {
      fail('the price list needs a source, a dated stamp and a models table — there is no default price for an unknown model')
    }
    pricing = raw as LivePricingInput
  }

  const report = unwrap(
    buildLiveReport({
      set: capture.set,
      sessions,
      grades,
      manifest,
      ...(pricing === undefined ? {} : { pricing }),
      generatedAt: new Date().toISOString(),
    }),
    'capture set and grades',
  )
  const body = format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : `${formatLiveReport(report)}`

  if (flags.get('out') === undefined) {
    process.stdout.write(body)
  } else {
    writeOut(flags.get('out')!, body, protectedPaths)
    const initial = report.populations.initial
    process.stdout.write(
      `written: ${display(flags.get('out')!)}\n` +
        `initial hunts verified ${initial.verifiedSuccess}/${initial.scheduled}` +
        (report.populations.revisedObjective.scheduled > 0
          ? `, follow-ups ${report.populations.revisedObjective.verifiedSuccess}/${report.populations.revisedObjective.scheduled}` +
            `, both steps ${report.populations.bothStep.verifiedSuccess}/${report.populations.bothStep.scheduled}`
          : '') +
        `\n${report.warnings.length} data-quality warning(s), ${report.anomalies.length} protocol anomaly(ies)\n`,
    )
  }
}

export {}
