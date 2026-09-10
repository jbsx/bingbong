#!/usr/bin/env node
// The Grading Bench entry point (`pnpm live:review`, #228): a loopback-only
// server and one page where a human records Grades over a live-web capture
// set — one attempt at a time, its Answer beside the Grading Key and the
// trail of what the assistant read.
//
// It is a script beside `pnpm live:report`, never an app view: evaluator
// material is not rendered in any view (glossary, Grading Key), and this is
// one of the two scripts allowed to import the keys — `corpus.test.ts`
// enforces the list. Node runs this .ts directly via type stripping (Node ≥
// 22.18), so every runtime import on its graph carries a .ts extension.
//
// Every input is an explicit path; nothing is discovered. The bench writes
// only the grades file and a drafts sidecar beside it, and only with Grades
// the real `parseLiveGrades` accepts.
//
// Usage:
//   pnpm live:review --capture=<capture-set.json> --keys=<key-manifest.json> --grades=<your-grades.json> \
//                    [--reviewer=<name>] [--compare=<other-reviewer-grades.json>] [--port N] [--no-open]
//
// The reviewer defaults to `git config user.name`. One grades file per
// reviewer: the bench refuses a file someone else has reviewed in.

import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { LIVE_PRIVATE_ROOT } from '../e2e/live/artifacts.ts'
import { resolveReviewer } from '../e2e/live/gradingBench.ts'
import { openGradingBench } from '../e2e/live/gradingBenchServer.ts'
import { gradingKeyFor, keyManifestOf } from '../e2e/live/keyManifest.ts'

const DEFAULT_PORT = 4227
const VALUE_FLAGS = ['capture', 'keys', 'grades', 'reviewer', 'compare', 'port'] as const
const REQUIRED_FLAGS = ['capture', 'keys', 'grades'] as const

function fail(message: string): never {
  process.stderr.write(`live:review: ${message}\n`)
  process.exit(1)
}

function parseArgv(argv: readonly string[]): { flags: Map<string, string>; open: boolean } {
  const flags = new Map<string, string>()
  let open = true
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--no-open') {
      open = false
      continue
    }
    if (!argument.startsWith('--')) fail(`unexpected argument "${argument}" — every input is a named path`)
    const separator = argument.indexOf('=')
    const name = separator === -1 ? argument.slice(2) : argument.slice(2, separator)
    if (!(VALUE_FLAGS as readonly string[]).includes(name)) {
      fail(`unknown option --${name} (it takes ${VALUE_FLAGS.map((flag) => `--${flag}`).join(', ')} and --no-open)`)
    }
    // `--port N` as `trace:ui` takes it; every path flag as --name=value.
    let value: string | undefined = separator === -1 ? undefined : argument.slice(separator + 1)
    if (value === undefined && name === 'port') value = argv[++index]
    if (value === undefined) fail(`--${name} needs a value, as --${name}=<value>`)
    if (value === '') fail(`--${name} was given an empty value`)
    if (flags.has(name)) fail(`--${name} was given more than once`)
    flags.set(name, value)
  }
  return { flags, open }
}

function gitUserName(): string | null {
  try {
    return execFileSync('git', ['config', 'user.name'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

function openInBrowser(url: string): void {
  const [command, commandArgs] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
  try {
    const child = spawn(command, commandArgs, { stdio: 'ignore', detached: true })
    child.on('error', () => console.log(`live:review could not open a browser; open ${url} yourself`))
    child.unref()
  } catch (error) {
    console.log(`live:review could not open a browser (${String(error)}); open ${url} yourself`)
  }
}

const { flags, open } = parseArgv(process.argv.slice(2))

const missing = REQUIRED_FLAGS.filter((flag) => !flags.has(flag))
if (missing.length > 0) {
  fail(
    `${missing.map((flag) => `--${flag}`).join(', ')} ${missing.length === 1 ? 'is' : 'are'} required — ` +
      'the bench discovers nothing: name the capture set, the key manifest and your own grades file',
  )
}

let port = DEFAULT_PORT
if (flags.has('port')) {
  port = Number(flags.get('port'))
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`--port needs an integer 0–65535, got ${JSON.stringify(flags.get('port'))}`)
}

const reviewer = resolveReviewer(flags.get('reviewer'), flags.get('reviewer')?.trim() ? null : gitUserName())
if (reviewer === null) fail('no reviewer — pass --reviewer=<name> or set git config user.name; an entry naming no one cannot be saved')

const gradesPath = resolve(flags.get('grades')!)
if (!gradesPath.startsWith(`${LIVE_PRIVATE_ROOT}/`)) {
  process.stderr.write(`live:review: warning — ${gradesPath} is outside the gitignored private root (${LIVE_PRIVATE_ROOT}).\n`)
  process.stderr.write('live:review: a grades file and its drafts carry reviewer notes about Answers. Do not commit them.\n')
}

const opened = openGradingBench({
  capturePath: flags.get('capture')!,
  keysPath: flags.get('keys')!,
  gradesPath,
  ...(flags.has('compare') ? { comparePath: flags.get('compare')! } : {}),
  reviewer,
  keyFor: (huntId) => gradingKeyFor(huntId),
  keyManifestFor: keyManifestOf,
  pageHtml: readFileSync(new URL('./live-review.html', import.meta.url), 'utf8'),
})
if (!opened.ok) {
  process.stderr.write('live:review: the bench cannot open:\n')
  for (const error of opened.errors) process.stderr.write(`  - ${error}\n`)
  process.exit(1)
}
const bench = opened.value

const server = createServer(bench.handle)
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') fail(`port ${port} is in use — pass --port N`)
  fail(`the server failed: ${error.message}`)
})
server.listen(port, '127.0.0.1', () => {
  const address = server.address()
  const bound = typeof address === 'object' && address !== null ? address.port : port
  const url = `http://127.0.0.1:${bound}/`
  console.log(`live:review grading capture set ${bench.setId} as ${bench.reviewer}`)
  console.log(`live:review grades: ${bench.gradesPath}`)
  console.log(`live:review drafts: ${bench.draftsPath}`)
  console.log(`live:review at ${url}`)
  if (open) openInBrowser(url)
})

function shutdown(): void {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 500).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
