#!/usr/bin/env node
// `pnpm bugs:add <turnId> --stage <stage> --happened "…" --meant "…"` (#371):
// one Failed Line written to the ledger from its logged record — the words,
// when, spoken or typed, the log file — with the first stage that failed
// it, what happened and what was meant. On an entry that exists, any field
// given replaces it: `--claimed #NNN` the issue that covers it, `--fixed
// <sha>` the commit, `--case <name>` the corpus case or e2e test guarding
// it, `--ruled "…"` the owner ruling that closes it. Node runs this .ts
// directly via type stripping (#36).
//
// Usage:
//   pnpm bugs:add <turnId> [--stage <stage>] [--happened "…"] [--meant "…"] [--claimed #NNN] [--fixed <sha>] [--case <name>] [--ruled "…"] [--logs <dir>] [--ledger <dir>]
//
// Defaults: the logs dir `pnpm perf:report` reads, and fixtures/failed-lines.

import { FAILED_LINES_DIR, addFailedLine, type FailedLineFields } from '../src/main/bugs/ledger.ts'
import { resolvePerfLogsDir } from '../src/main/perf/collectPerfRecords.ts'

const USAGE = 'usage: pnpm bugs:add <turnId> [--stage stt|turn|local_match|reading|missing_option|runner|player|page] [--happened "…"] [--meant "…"] [--claimed #NNN] [--fixed <sha>] [--case <name>] [--ruled "…"] [--logs <dir>] [--ledger <dir>]'

const FLAGS: Readonly<Record<string, keyof FailedLineFields | 'logs' | 'ledger'>> = {
  '--stage': 'stage',
  '--happened': 'happened',
  '--meant': 'meant',
  '--claimed': 'claimedBy',
  '--fixed': 'fixedBy',
  '--case': 'case',
  '--ruled': 'ruled',
  '--logs': 'logs',
  '--ledger': 'ledger',
}

const positional: string[] = []
const given: Partial<Record<keyof FailedLineFields | 'logs' | 'ledger', string>> = {}
const args = process.argv.slice(2)
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]!
  if (!arg.startsWith('--')) {
    positional.push(arg)
    continue
  }
  const field = FLAGS[arg]
  const value = args[index + 1]
  if (field === undefined || value === undefined) {
    console.error(field === undefined ? `bugs:add: unknown option ${arg}` : `bugs:add: ${arg} takes a value`)
    console.error(USAGE)
    process.exit(2)
  }
  given[field] = value
  index += 1
}

const id = positional[0]
if (id === undefined || positional.length > 1) {
  console.error(USAGE)
  process.exit(2)
}
const { logs, ledger, ...fields } = given
const made = addFailedLine(resolvePerfLogsDir(logs !== undefined ? [logs] : [], process.env), ledger ?? FAILED_LINES_DIR, id, fields)
if ('error' in made) {
  console.error(`bugs:add: ${made.error}`)
  console.error(USAGE)
  process.exit(1)
}
console.log(`${made.replaced ? 'updated' : 'wrote'} ${made.path}`)
