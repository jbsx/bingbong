#!/usr/bin/env node
// `pnpm live:unasked` (#287): writes the second reading — verified, or
// failing only on unasked facts — into the aggregate audits a reports
// directory already holds, from the per-Pass audits beside them.
//
// It spends nothing and asks no reviewer: the reading is a function of each
// attempt's Grade status and `checksUnsatisfied`, which the committed
// `audit-<set>.json` files keep. It reads no capture, no grades file and no
// key. Run it after the list in `e2e/live/unaskedFacts.ts` changes; an
// aggregate `pnpm live:audit` writes carries the reading already.
//
// It restates rather than rebuilds. A whole rebuild of an aggregate written
// by an older audit would add every counter introduced since as a zero
// nobody counted, and re-word its Markdown; this adds the one field to each
// population and the one section to the Markdown, and leaves every other
// byte as written. Running it twice writes the same files.
//
// Usage:
//   pnpm live:unasked [--reports=<dir>] [--dry-run]
//
// Node runs this .ts directly via type stripping (Node ≥ 22.18), so every
// runtime import on its graph carries a .ts extension.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileAtomic } from '../e2e/live/artifacts.ts'
import { LIVE_AUDIT_AGGREGATE_KIND, LIVE_AUDIT_KIND, recordedReadingOf, restateVerifiedOrUnasked, restateVerifiedOrUnaskedMarkdown, type AuditAggregate, type AuditSetOutput, type VerifiedOrUnasked } from '../e2e/live/audit.ts'

const DEFAULT_REPORTS_DIR = fileURLToPath(new URL('../e2e/live/reports/', import.meta.url))

function fail(message: string, details: readonly string[] = []): never {
  process.stderr.write(`live:unasked: ${message}\n${details.map((detail) => `  ${detail}\n`).join('')}`)
  process.exit(1)
}

function parseArgv(argv: readonly string[]): { reportsDir: string; dryRun: boolean } {
  let reportsDir: string | null = null
  let dryRun = false
  for (const argument of argv) {
    if (argument === '--dry-run') dryRun = true
    else if (argument.startsWith('--reports=') && reportsDir === null && argument.length > '--reports='.length) reportsDir = resolve(argument.slice('--reports='.length))
    else fail(`unexpected argument "${argument}" — it takes --reports=<dir> once and --dry-run`)
  }
  return { reportsDir: reportsDir ?? DEFAULT_REPORTS_DIR, dryRun }
}

function readingText(attempts: number, reading: VerifiedOrUnasked | undefined): string {
  const read = recordedReadingOf(attempts, reading)
  if (read === null || reading === undefined) return 'not recorded'
  return `${reading.verified} verified + ${reading.failingOnlyOnUnasked} = ${read.sum} of ${read.recorded}`
}

const { reportsDir, dryRun } = parseArgv(process.argv.slice(2))
if (!existsSync(reportsDir)) fail(`no reports directory at ${reportsDir}`)

const sets: AuditSetOutput[] = []
const aggregates: { name: string; text: string; audit: AuditAggregate }[] = []
for (const name of readdirSync(reportsDir).filter((file) => file.startsWith('audit-') && file.endsWith('.json')).sort()) {
  const text = readFileSync(join(reportsDir, name), 'utf8')
  let json: { kind?: unknown }
  try {
    json = JSON.parse(text) as { kind?: unknown }
  } catch (error) {
    fail(`${name} is not JSON — nothing was written`, [String(error)])
  }
  if (json.kind === LIVE_AUDIT_KIND) sets.push(json as AuditSetOutput)
  else if (json.kind === LIVE_AUDIT_AGGREGATE_KIND) aggregates.push({ name, text, audit: json as AuditAggregate })
}
if (aggregates.length === 0) fail(`no aggregate audit in ${reportsDir}`)

// Everything is restated before anything is written: one aggregate that
// cannot be read leaves the directory as it was.
const writes: { path: string; text: string }[] = []
const lines: string[] = []
for (const { name, text, audit } of aggregates) {
  const markdownName = name.replace(/\.json$/, '.md')
  const markdownPath = join(reportsDir, markdownName)
  if (!existsSync(markdownPath)) fail(`${name} has no ${markdownName} beside it — nothing was written`)
  const restated = restateVerifiedOrUnasked(audit, sets)
  if (!restated.ok) fail(`${name} cannot be restated — nothing was written`, restated.errors)
  const writtenMarkdown = readFileSync(markdownPath, 'utf8')
  const markdown = restateVerifiedOrUnaskedMarkdown(writtenMarkdown, restated.value)
  if (!markdown.ok) fail(`${markdownName} cannot be restated — nothing was written`, markdown.errors)
  const json = `${JSON.stringify(restated.value, null, 2)}\n`
  if (json !== text) writes.push({ path: join(reportsDir, name), text: json })
  if (markdown.value !== writtenMarkdown) writes.push({ path: markdownPath, text: markdown.value })
  const { initial, followUp } = restated.value.populations
  lines.push(`${name}: initial ${readingText(initial.attempts, initial.verifiedOrUnasked)}; follow-up ${readingText(followUp.attempts, followUp.verifiedOrUnasked)}`)
}

if (!dryRun) for (const write of writes) writeFileAtomic(write.path, write.text)
for (const line of lines) console.log(line)
console.log(`live:unasked ${dryRun ? 'would write' : 'wrote'} ${writes.length} file(s) over ${aggregates.length} aggregate audit(s) in ${reportsDir}`)
