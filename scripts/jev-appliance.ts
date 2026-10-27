#!/usr/bin/env node
// `pnpm jev:appliance [corpus-dir] [--expect]` (#485): every hop-0 case in the
// Jev corpus given its Appliance companion — the Appliance Card the real
// builder makes from the state the case recorded, with the answers the
// line should get on it — written beside it as `<name>-appliance.json`, as
// #370 converted the corpus. Run again after a change to the card's
// wording: each companion's ask is rebuilt, its expectations kept unless
// `--expect` derives them again. A line read
// on both cards is through the gate only when both of its cases are.
// Node runs this .ts directly via type stripping (#36).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { registerHooks } from 'node:module'

// The card's builder imports carry no .ts extension: the resolve hook tries the .ts file first (as stt:gate does).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!/^\.\.?\//.test(specifier) || /\.[cm]?[jt]s$/.test(specifier)) return nextResolve(specifier, context)
    try {
      return nextResolve(`${specifier}.ts`, context)
    } catch {
      return nextResolve(specifier, context)
    }
  },
})
const { JEV_CORPUS_DIR, readCorpus } = (await import('../src/main/decision/jevCorpus.ts')) as typeof import('../src/main/decision/jevCorpus')
const { companionCase, companionName, isCompanionName } = (await import('../src/core/decision/applianceCompanion.ts')) as typeof import('../src/core/decision/applianceCompanion')

const args = process.argv.slice(2)
// --expect derives every companion's expectations afresh from its case; otherwise a companion's own are kept.
const rederive = args.includes('--expect')
const dir = args.find((arg) => !arg.startsWith('--')) ?? JEV_CORPUS_DIR

let written = 0
let kept = 0
const skipped: string[] = []
for (const entry of readCorpus(dir)) {
  if (typeof entry.case === 'string' || isCompanionName(entry.name)) continue
  const path = join(dir, `${companionName(entry.name)}.json`)
  // A companion grown by hand (`pnpm jev:case … --appliance`) keeps its expectations; its ask is rebuilt.
  const before = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as { expect?: unknown }) : null
  const companion = companionCase(entry.name, entry.case)
  if (companion === null) {
    skipped.push(entry.name)
    continue
  }
  const expect = before?.expect !== undefined && !rederive ? before.expect : companion.expect
  writeFileSync(path, `${JSON.stringify({ ...companion, expect }, null, 2)}\n`)
  if (before !== null) kept += 1
  written += 1
}
console.log(`${written} companions written in ${dir} (${kept} rebuilt over an earlier one); ${skipped.length} cases have none (a later hop, a settings ask, another kind)`)
