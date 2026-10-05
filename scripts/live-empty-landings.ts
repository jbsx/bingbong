#!/usr/bin/env node
// The Empty Landing sweep (`pnpm live:empty-landings`, #304): reads the Run
// Trace of every attempt a committed Round Audit names and writes the marks
// the Fix Ledger recounts an older audit from — each Empty Landing, and each
// Page Read that returned text from one — and, since #309, each page arrival
// by a click, a type or a step through history, whether it showed no text
// and whether it was an Unfinished Load. A committed audit keeps 240
// characters of a result, which cannot say any of them, so the recount is of
// the traces; a capture set with no trace on disk keeps its counts and is
// named as not recounted.
//
// It reads audit JSON and retained Run Traces only — no grades file, no key —
// and writes two generated modules. Node runs this .ts directly via type
// stripping (Node ≥ 22.18), so every runtime import on its graph carries a
// .ts extension.
//
// Usage:
//   pnpm live:empty-landings [--reports=<dir>] [--artifacts=<dir>] [--out=<file>] [--arrivals-out=<file>] [--dry-run]
//
// Without flags it reads e2e/live/reports and e2e/live/artifacts and writes
// e2e/live/emptyLandingMarks.ts and e2e/live/pageArrivalMarks.ts. Run it where the captures are: a worktree
// holds none, and would name every set as not recounted.

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIVE_ARTIFACTS_ROOT, attemptTraceRecords, writeFileAtomic } from '../e2e/live/artifacts.ts'
import { LIVE_AUDIT_KIND, SEARCH_STREAK_RULE, emptyLandingMarksOf, pageArrivalMarksOf, type AuditSetOutput, type EmptyLandingMark } from '../e2e/live/audit.ts'
import { familyIdOf } from '../e2e/live/ledger.ts'
import { EMPTY_LANDING_RECOUNT_RULE, type RecountedAttempt } from '../e2e/live/emptyLandingRecount.ts'
import type { RecountedArrivals } from '../e2e/live/pageArrivalRecount.ts'

// The marks are of what this reading of the rule added; a later one is read as it.
if (SEARCH_STREAK_RULE < EMPTY_LANDING_RECOUNT_RULE) throw new Error(`the streak rule is ${SEARCH_STREAK_RULE}, below the one that made an Empty Landing hold`)

const DEFAULT_REPORTS_DIR = fileURLToPath(new URL('../e2e/live/reports/', import.meta.url))
const DEFAULT_OUT = fileURLToPath(new URL('../e2e/live/emptyLandingMarks.ts', import.meta.url))
const DEFAULT_ARRIVALS_OUT = fileURLToPath(new URL('../e2e/live/pageArrivalMarks.ts', import.meta.url))

function fail(message: string): never {
  process.stderr.write(`live:empty-landings: ${message}\n`)
  process.exit(1)
}

function parseArgv(argv: readonly string[]): { reportsDir: string; artifactsDir: string; out: string; arrivalsOut: string; dryRun: boolean } {
  let reportsDir = DEFAULT_REPORTS_DIR
  let artifactsDir = LIVE_ARTIFACTS_ROOT
  let out = DEFAULT_OUT
  let arrivalsOut = DEFAULT_ARRIVALS_OUT
  let dryRun = false
  for (const argument of argv) {
    if (argument === '--dry-run') {
      dryRun = true
      continue
    }
    const match = /^--(reports|artifacts|out|arrivals-out)=(.+)$/.exec(argument)
    if (match === null) fail(`unexpected argument "${argument}" — it takes --reports=<dir>, --artifacts=<dir>, --out=<file>, --arrivals-out=<file> and --dry-run`)
    if (match[1] === 'reports') reportsDir = resolve(match[2]!)
    else if (match[1] === 'artifacts') artifactsDir = resolve(match[2]!)
    else if (match[1] === 'arrivals-out') arrivalsOut = resolve(match[2]!)
    else out = resolve(match[2]!)
  }
  return { reportsDir, artifactsDir, out, arrivalsOut, dryRun }
}

const { reportsDir, artifactsDir, out, arrivalsOut, dryRun } = parseArgv(process.argv.slice(2))

const recounted: RecountedAttempt[] = []
const arrived: RecountedArrivals[] = []
const notRecounted = new Set<string>()
const sets: string[] = []
const misplaced: string[] = []

for (const name of readdirSync(reportsDir).filter((candidate) => candidate.startsWith('audit-') && candidate.endsWith('.json')).sort()) {
  const audit = JSON.parse(readFileSync(join(reportsDir, name), 'utf8')) as AuditSetOutput
  if (audit.kind !== LIVE_AUDIT_KIND) continue
  const { setId } = audit.provenance
  const family = familyIdOf(setId).family
  let onDisk = true
  const found: RecountedAttempt[] = []
  const foundArrivals: RecountedArrivals[] = []
  for (const { mechanical } of audit.attempts) {
    const records = attemptTraceRecords(artifactsDir, mechanical.captureId, mechanical.attemptId)
    if (records === null || (records.length === 0 && mechanical.rounds.length > 0)) {
      onDisk = false
      break
    }
    const marks: EmptyLandingMark[] = emptyLandingMarksOf(records)
    const arrivals = pageArrivalMarksOf(records)
    // A mark is of the call the audit holds at that place, or it is of another reading of the trace.
    for (const mark of [...marks, ...arrivals]) {
      const call = mechanical.rounds[mark.round - 1]?.calls[mark.call]
      if (call === undefined || call.name !== mark.name) misplaced.push(`${mechanical.captureId} ${mechanical.attemptId} round ${mark.round} call ${mark.call}: the audit holds ${call?.name ?? 'no call'}, the trace ${mark.name}`)
    }
    found.push({ captureId: mechanical.captureId, attemptId: mechanical.attemptId, marks })
    foundArrivals.push({ captureId: mechanical.captureId, attemptId: mechanical.attemptId, marks: arrivals })
  }
  if (!onDisk) {
    notRecounted.add(family)
    continue
  }
  sets.push(setId)
  recounted.push(...found)
  arrived.push(...foundArrivals)
}

if (misplaced.length > 0) fail(`a mark does not sit on the call the committed audit holds:\n  ${misplaced.join('\n  ')}`)

// A family some of whose Passes have no trace is recounted where it can be; it is named for the Passes that could not.
const withMarks = recounted.filter((attempt) => attempt.marks.length > 0)
const landings = withMarks.reduce((total, attempt) => total + attempt.marks.filter((mark) => mark.host !== undefined).length, 0)
const reads = withMarks.reduce((total, attempt) => total + attempt.marks.filter((mark) => mark.read === true).length, 0)

const lines = [
  '// GENERATED by `pnpm live:empty-landings` (#304) from the Run Traces of the',
  '// captures on disk. Do not edit by hand: run the sweep where the captures are.',
  '//',
  `// ${sets.length} capture sets read, ${recounted.length} attempts, ${landings} Empty Landings, ${reads} Page Reads that returned text from one.`,
  '',
  "import type { RecountedAttempt } from './emptyLandingRecount.ts'",
  '',
  '/**',
  ' * The capture sets whose traces were read: an attempt of one with no entry',
  ' * below met no Empty Landing. A set that is not listed had no trace on disk,',
  ' * and keeps the counts its audit wrote.',
  ' */',
  `export const EMPTY_LANDING_SETS_RECOUNTED: readonly string[] = ${JSON.stringify(sets)}`,
  '',
  '/** Every attempt that met an Empty Landing, with where its rounds hold each and the Page Reads that returned text from one. */',
  'export const EMPTY_LANDING_MARKS: readonly RecountedAttempt[] = [',
  ...withMarks.map((attempt) => `  ${JSON.stringify(attempt)},`),
  ']',
  '',
]

// #309: the page arrivals, over the same attempts.
const withArrivals = arrived.filter((attempt) => attempt.marks.length > 0)
const arrivalMarks = withArrivals.flatMap((attempt) => attempt.marks)
const arrivalCount = (name: string, noText: boolean): number => arrivalMarks.filter((mark) => mark.name === name && (!noText || mark.noText === true)).length
const arrivalSummary = ['click', 'type', 'back', 'go_forward'].map((name) => `${name} ${arrivalCount(name, false)} (${arrivalCount(name, true)} with no text)`).join(', ')
const unfinished = arrivalMarks.filter((mark) => mark.unfinished === true).length

const arrivalLines = [
  '// GENERATED by `pnpm live:empty-landings` (#309) from the Run Traces of the',
  '// captures on disk. Do not edit by hand: run the sweep where the captures are.',
  '//',
  `// ${sets.length} capture sets read, ${arrived.length} attempts, ${arrivalMarks.length} page arrivals by a click, a type or a step through history:`,
  `// ${arrivalSummary}; ${unfinished} Unfinished Loads.`,
  '',
  "import type { RecountedArrivals } from './pageArrivalRecount.ts'",
  '',
  '/**',
  ' * The capture sets whose traces were read: an attempt of one with no entry',
  ' * below made no page arrival. A set that is not listed had no trace on disk.',
  ' */',
  `export const PAGE_ARRIVAL_SETS_RECOUNTED: readonly string[] = ${JSON.stringify(sets)}`,
  '',
  '/** Every attempt that made a page arrival, with where its rounds hold each and what it was. */',
  'export const PAGE_ARRIVAL_MARKS: readonly RecountedArrivals[] = [',
  ...withArrivals.map((attempt) => `  ${JSON.stringify(attempt)},`),
  ']',
  '',
]

console.log(`live:empty-landings read ${sets.length} capture sets (${recounted.length} attempts): ${landings} Empty Landings, ${reads} read with text`)
console.log(`live:empty-landings page arrivals: ${arrivalSummary}; ${unfinished} Unfinished Loads`)
console.log(`live:empty-landings could not recount ${notRecounted.size === 0 ? 'no family' : [...notRecounted].sort().join(', ')}`)
if (dryRun) {
  for (const attempt of withMarks) console.log(`  ${attempt.captureId} ${attempt.attemptId}: ${attempt.marks.map((mark) => `${mark.round}${mark.read === true ? ' read' : ` ${mark.host}`}`).join(', ')}`)
} else {
  writeFileAtomic(out, lines.join('\n'))
  writeFileAtomic(arrivalsOut, arrivalLines.join('\n'))
  console.log(`live:empty-landings wrote ${out} and ${arrivalsOut}`)
}
