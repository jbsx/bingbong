#!/usr/bin/env node
// The evaluator's key-manifest entry point (`pnpm live:keys`, #227).
//
// `keys.ts` holds the substantive keys; `grades.ts` grades against a key
// manifest. This writes the second from the first, so a captured pilot can
// actually be graded. Offline: it reads the corpus module and writes one
// JSON file. No Electron, no model, no browser, no network.
//
// Usage:
//   pnpm live:keys --out=<key-manifest.json>
//   pnpm live:keys --live-facts            # what to recheck before a paid capture
//
// THE OUTPUT IS EVALUATOR MATERIAL. Its check descriptions are the key's own
// words about what a correct Answer says. It belongs in the gitignored
// private root beside the key, never in a report, never in a commit, and
// never in the measured assistant's context.
//
// It refuses to overwrite. Regenerating after a key revision is normal, but
// silently replacing a manifest that reviews were already written against
// would strand those reviews under a key version that no longer exists — so
// the old file is named, with its version, and the evaluator decides.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { LIVE_PRIVATE_ROOT } from '../e2e/live/artifacts.ts'
import { parseLiveKeyManifest } from '../e2e/live/grades.ts'
import { buildLiveKeyManifest, liveFactsToRecheck } from '../e2e/live/keyManifest.ts'

const FLAGS = ['out', 'live-facts'] as const

function fail(message: string): never {
  process.stderr.write(`live:keys: ${message}\n`)
  process.exit(1)
}

function parseArgv(argv: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>()
  for (const argument of argv) {
    if (!argument.startsWith('--')) fail(`unexpected argument "${argument}" — this command takes only --${FLAGS.join(', --')}`)
    const separator = argument.indexOf('=')
    const name = separator === -1 ? argument.slice(2) : argument.slice(2, separator)
    const value = separator === -1 ? '' : argument.slice(separator + 1)
    if (!FLAGS.includes(name as (typeof FLAGS)[number])) {
      fail(`unknown option --${name} (it takes ${FLAGS.map((flag) => `--${flag}`).join(', ')})`)
    }
    if (flags.has(name)) fail(`--${name} was given more than once`)
    flags.set(name, value)
  }
  return flags
}

function reportLiveFacts(): never {
  const pending = liveFactsToRecheck()
  if (pending.length === 0) {
    process.stdout.write('no key claims a fact that can move; nothing to recheck\n')
    process.exit(0)
  }
  for (const { huntId, liveFacts } of pending) {
    process.stdout.write(`${huntId}\n`)
    for (const fact of liveFacts) process.stdout.write(`  - ${fact}\n`)
  }
  process.exit(0)
}

function main(argv: readonly string[]): void {
  const flags = parseArgv(argv)
  if (flags.has('live-facts')) reportLiveFacts()

  const out = flags.get('out')
  if (out === undefined || out === '') fail('--out is required, naming the manifest file to write')

  const target = resolve(out)
  if (!target.startsWith(`${LIVE_PRIVATE_ROOT}/`)) {
    process.stderr.write(`live:keys: warning — ${target} is outside the gitignored private root (${LIVE_PRIVATE_ROOT}).\n`)
    process.stderr.write('live:keys: a manifest carries the key’s own words about a correct Answer. Do not commit it.\n')
  }

  if (existsSync(target)) {
    fail(`${target} already exists — reviews may be bound to it. Move it aside, or write the new manifest elsewhere`)
  }

  const manifest = buildLiveKeyManifest()
  const parsed = parseLiveKeyManifest(manifest)
  if (!parsed.ok) {
    process.stderr.write('live:keys: the generated manifest is not valid\n')
    for (const error of parsed.errors) process.stderr.write(`  - ${error}\n`)
    process.exit(1)
  }

  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })

  const checks = manifest.tasks.reduce((total, task) => total + task.checks.length, 0)
  process.stdout.write(
    `wrote ${target}\n` +
      `  key ${manifest.keyVersion}, prepared ${manifest.preparedAt}, digest ${manifest.keyDigest.slice(0, 19)}…\n` +
      `  ${manifest.tasks.length} scheduled slots, ${checks} checks for a reviewer to judge\n` +
      '  read each key’s `constraints` before judging its checks: some decide a verdict\n',
  )
}

main(process.argv.slice(2))
