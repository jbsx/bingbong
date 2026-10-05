#!/usr/bin/env node
// The Answer naming sweep (`pnpm live:answer-namings`, #323): reads the Run
// Trace of every attempt a committed Round Audit names and writes the marks
// the Fix Ledger recounts an older audit from — for each Answer that names
// the stop or the bound, or carries one of the application's internal names,
// where and which phrase. A committed audit keeps no Answer text, so the
// recount is of the traces; a capture set with no trace on disk is named as
// not recounted.
//
// It reads audit JSON and retained Run Traces only — no grades file, no key —
// and writes one generated module, which holds the phrases and none of the
// words around them. The words are printed here, where they can be read and
// are not committed. Node runs this .ts directly via type stripping (Node ≥
// 22.18), so every runtime import on its graph carries a .ts extension.
//
// Usage:
//   pnpm live:answer-namings [--reports=<dir>] [--artifacts=<dir>] [--out=<file>] [--dry-run]
//
// Without flags it reads e2e/live/reports and e2e/live/artifacts and writes
// e2e/live/answerNamingMarks.ts. Run it where the captures are: a worktree
// holds none, and would name every set as not recounted.

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIVE_ARTIFACTS_ROOT, attemptTraceRecords, writeFileAtomic } from '../e2e/live/artifacts.ts'
import { LIVE_AUDIT_KIND, addAnswerNaming, answerNamingCountsText, answerNamingsOf, emptyAnswerNamingCounts, endedUnmet, type AnswerNamingCounts, type AuditSetOutput } from '../e2e/live/audit.ts'
import type { AnswerNamingHit } from '../e2e/live/answerNamings.ts'
import type { RecountedNamings } from '../e2e/live/answerNamingRecount.ts'
import { familyIdOf } from '../e2e/live/ledger.ts'

const DEFAULT_REPORTS_DIR = fileURLToPath(new URL('../e2e/live/reports/', import.meta.url))
const DEFAULT_OUT = fileURLToPath(new URL('../e2e/live/answerNamingMarks.ts', import.meta.url))

function fail(message: string): never {
  process.stderr.write(`live:answer-namings: ${message}\n`)
  process.exit(1)
}

function parseArgv(argv: readonly string[]): { reportsDir: string; artifactsDir: string; out: string; dryRun: boolean } {
  let reportsDir = DEFAULT_REPORTS_DIR
  let artifactsDir = LIVE_ARTIFACTS_ROOT
  let out = DEFAULT_OUT
  let dryRun = false
  for (const argument of argv) {
    if (argument === '--dry-run') {
      dryRun = true
      continue
    }
    const match = /^--(reports|artifacts|out)=(.+)$/.exec(argument)
    if (match === null) fail(`unexpected argument "${argument}" — it takes --reports=<dir>, --artifacts=<dir>, --out=<file> and --dry-run`)
    if (match[1] === 'reports') reportsDir = resolve(match[2]!)
    else if (match[1] === 'artifacts') artifactsDir = resolve(match[2]!)
    else out = resolve(match[2]!)
  }
  return { reportsDir, artifactsDir, out, dryRun }
}

const { reportsDir, artifactsDir, out, dryRun } = parseArgv(process.argv.slice(2))

/** One model-written Answer as the sweep read it, with the words around each phrase. */
interface ReadAnswer {
  readonly captureId: string
  readonly attemptId: string
  readonly unmet: boolean
  readonly stop: readonly AnswerNamingHit[]
  readonly internal: readonly AnswerNamingHit[]
}

const read: ReadAnswer[] = []
const unanswered: { captureId: string; attemptId: string }[] = []
const notRecounted = new Set<string>()
const sets: string[] = []
const byFamily = new Map<string, AnswerNamingCounts>()
const total = emptyAnswerNamingCounts()

for (const name of readdirSync(reportsDir).filter((candidate) => candidate.startsWith('audit-') && candidate.endsWith('.json')).sort()) {
  const audit = JSON.parse(readFileSync(join(reportsDir, name), 'utf8')) as AuditSetOutput
  if (audit.kind !== LIVE_AUDIT_KIND) continue
  const { setId } = audit.provenance
  const family = familyIdOf(setId).family
  let onDisk = true
  const found: ReadAnswer[] = []
  const without: { captureId: string; attemptId: string }[] = []
  for (const { mechanical } of audit.attempts) {
    const records = attemptTraceRecords(artifactsDir, mechanical.captureId, mechanical.attemptId)
    if (records === null || (records.length === 0 && mechanical.rounds.length > 0)) {
      onDisk = false
      break
    }
    const namings = answerNamingsOf(records)
    const identity = { captureId: mechanical.captureId, attemptId: mechanical.attemptId }
    if (namings === null) without.push(identity)
    else found.push({ ...identity, unmet: endedUnmet(mechanical), stop: namings.stop, internal: namings.internal })
  }
  if (!onDisk) {
    notRecounted.add(family)
    continue
  }
  sets.push(setId)
  read.push(...found)
  unanswered.push(...without)
  const counts = byFamily.get(family) ?? emptyAnswerNamingCounts()
  byFamily.set(family, counts)
  for (const answer of found) {
    addAnswerNaming(counts, answer.unmet, answer.stop.length, answer.internal.length)
    addAnswerNaming(total, answer.unmet, answer.stop.length, answer.internal.length)
  }
}

const marked: RecountedNamings[] = read
  .filter((answer) => answer.stop.length > 0 || answer.internal.length > 0)
  .map((answer) => ({
    captureId: answer.captureId,
    attemptId: answer.attemptId,
    stop: answer.stop.map(({ where, phrase }) => ({ where, phrase })),
    internal: answer.internal.map(({ where, phrase }) => ({ where, phrase })),
  }))

const familyLines = [...byFamily.entries()].map(([family, counts]) => `${family}: ${answerNamingCountsText(counts)}`)

const lines = [
  '// GENERATED by `pnpm live:answer-namings` (#323) from the Run Traces of the',
  '// captures on disk. Do not edit by hand: run the sweep where the captures are.',
  '//',
  `// ${sets.length} capture sets read, ${read.length + unanswered.length} attempts, ${unanswered.length} of them with no model-written Answer:`,
  `// ${answerNamingCountsText(total)}.`,
  '//',
  '// By capture set family:',
  ...familyLines.map((line) => `//   ${line}`),
  '',
  "import type { RecountedNamings } from './answerNamingRecount.ts'",
  '',
  '/**',
  ' * The capture sets whose traces were read: an attempt of one with no entry',
  ' * below was answered by a model and its Answer carried no phrase. A set that',
  ' * is not listed had no trace on disk.',
  ' */',
  `export const ANSWER_NAMING_SETS_RECOUNTED: readonly string[] = ${JSON.stringify(sets)}`,
  '',
  '/** The attempts in which the user met no model-written Answer: none at all, or the Deterministic Answer. */',
  'export const ANSWER_NAMING_UNANSWERED: readonly { readonly captureId: string; readonly attemptId: string }[] = [',
  ...unanswered.map((attempt) => `  ${JSON.stringify(attempt)},`),
  ']',
  '',
  '/** Every attempt whose Answer names the stop or carries an internal name, with where each phrase was read. */',
  'export const ANSWER_NAMING_MARKS: readonly RecountedNamings[] = [',
  ...marked.map((attempt) => `  ${JSON.stringify(attempt)},`),
  ']',
  '',
]

console.log(`live:answer-namings read ${sets.length} capture sets (${read.length + unanswered.length} attempts, ${unanswered.length} with no model-written Answer): ${answerNamingCountsText(total)}`)
for (const line of familyLines) console.log(`  ${line}`)
console.log(`live:answer-namings could not recount ${notRecounted.size === 0 ? 'no family' : [...notRecounted].sort().join(', ')}`)
// The words around each phrase, to be read here: they are the Answer's own and are not written.
for (const answer of read) {
  for (const [list, hits] of [['the stop', answer.stop], ['internal name', answer.internal]] as const) {
    for (const hit of hits) console.log(`  ${answer.captureId} ${answer.attemptId} [${list}, ${hit.where}] "${hit.phrase}": …${hit.excerpt}…`)
  }
}
if (!dryRun) {
  writeFileAtomic(out, lines.join('\n'))
  console.log(`live:answer-namings wrote ${out}`)
}
