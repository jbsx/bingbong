#!/usr/bin/env node
// `pnpm jev:case <turnId> --expect <question>=<label> [...]` (#338): the ask
// a logged Command was read from — or a partial's ask, by its own id — with
// the answer each question should have got, written as a case in the Jev
// corpus for `pnpm jev:replay`. An expectation is a Choice label
// (`action=click-27`), a label at a floor (`outcome=yes>=0.7`, #366), a
// label it must not be (`action!=click-21`) or not at a floor
// (`outcome!=yes>=0.7`, #403), or a ceiling on whatever it
// chooses (`outcome<0.7`); each is checked against the ask's own
// questions before anything is written.
// With --appliance (#485) the logged page-card ask is written as its
// Appliance companion, `<turnId>-appliance`: the Appliance Card the real
// builder makes from the state it recorded, for a line logged before the
// Appliance Card asked it itself; the expectations judge that card.
// The asks carry page text from real browsing: a case is committed only
// when the owner chooses to. Node runs this .ts directly via type
// stripping (#36).
//
// Usage:
//   pnpm jev:case <turnId> --expect action=click-27 [action!=click-21 …] [--logs <dir>] [--corpus <dir>] [--appliance]
//
// Defaults: the logs dir `pnpm perf:report` reads, and fixtures/jev-cases.

import { registerHooks } from 'node:module'
import { JEV_CORPUS_DIR, caseFromLog } from '../src/main/decision/jevCorpus.ts'
import { resolvePerfLogsDir } from '../src/main/perf/collectPerfRecords.ts'

const USAGE = 'usage: pnpm jev:case <turnId> --expect <question>=<label>[>=<probability>] [<question>!=<label>[>=<probability>] <question><<probability> …] [--logs <dir>] [--corpus <dir>] [--appliance]'

const positional: string[] = []
const expectations: string[] = []
let logs: string | undefined
let corpus: string | undefined
let flag: string | null = null
let asAppliance = false
for (const arg of process.argv.slice(2)) {
  if (arg === '--appliance') {
    asAppliance = true
    continue
  }
  if (arg.startsWith('--')) {
    if (arg !== '--expect' && arg !== '--logs' && arg !== '--corpus') {
      console.error(`jev:case: unknown option ${arg}`)
      console.error(USAGE)
      process.exit(2)
    }
    flag = arg
    continue
  }
  if (flag === '--logs') logs = arg
  else if (flag === '--corpus') corpus = arg
  // --expect takes every expectation after it; the first word that is none is the turn id.
  else if (flag === '--expect' && (arg.includes('=') || arg.includes('<'))) {
    expectations.push(arg)
    continue
  } else positional.push(arg)
  flag = null
}

const id = positional[0]
if (id === undefined || positional.length > 1) {
  console.error(USAGE)
  process.exit(2)
}
let appliance: Parameters<typeof caseFromLog>[4]
if (asAppliance) {
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
  const { applianceAskOf } = (await import('../src/core/decision/applianceCompanion.ts')) as typeof import('../src/core/decision/applianceCompanion')
  appliance = { convert: (ask) => applianceAskOf(ask) }
}
const made = caseFromLog(resolvePerfLogsDir(logs !== undefined ? [logs] : [], process.env), id, expectations, corpus ?? JEV_CORPUS_DIR, appliance)
if ('error' in made) {
  console.error(`jev:case: ${made.error}`)
  console.error(USAGE)
  process.exit(1)
}
console.log(`${made.replaced ? 'replaced' : 'wrote'} ${made.path}`)
