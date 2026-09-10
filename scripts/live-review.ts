#!/usr/bin/env node
// The Grading Bench entry point (`pnpm live:review`, #228, #229): a
// loopback-only server where a human records Grades over a live-web capture
// set — one attempt at a time, its Answer beside the Grading Key and the
// trail of what the assistant read.
//
// It is a script beside `pnpm live:report`, never an app view: evaluator
// material is not rendered in any view (glossary, Grading Key), and this is
// one of the two scripts allowed to import the keys — `corpus.test.ts`
// enforces the list. Node runs this .ts directly via type stripping (Node ≥
// 22.18), so every runtime import on its graph carries a .ts extension.
//
// It takes no paths. It opens a setup page that proposes from the two fixed
// roots — every capture set in the artifacts root, and the grades file the
// reviewer's work goes into in the private root — beside the key manifest,
// built in memory from the committed keys. The bench proposes and the
// reviewer confirms: nothing is opened, and nothing written, until Start.
// `live:report` and `live:keys` keep their explicit paths.
//
// Usage:
//   pnpm live:review [--port N] [--no-open]
//
// The reviewer field starts as `git config user.name`. One grades file per
// reviewer: the bench refuses a file someone else has reviewed in.

import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { LIVE_ARTIFACTS_ROOT, LIVE_PRIVATE_ROOT, redactedMessage } from '../e2e/live/artifacts.ts'
import { parseLiveKeyManifest, type LiveKeyManifest } from '../e2e/live/grades.ts'
import { openGradingSetup } from '../e2e/live/gradingBenchServer.ts'
import { buildLiveKeyManifest, gradingKeyFor } from '../e2e/live/keyManifest.ts'

const DEFAULT_PORT = 4227

function fail(message: string): never {
  process.stderr.write(`live:review: ${message}\n`)
  process.exit(1)
}

function parseArgv(argv: readonly string[]): { port: number; open: boolean } {
  let port: number | null = null
  let open = true
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--no-open') {
      open = false
      continue
    }
    if (!argument.startsWith('--')) fail(`unexpected argument "${argument}" — it takes only --port N and --no-open`)
    const separator = argument.indexOf('=')
    const name = separator === -1 ? argument.slice(2) : argument.slice(2, separator)
    if (name !== 'port') {
      fail(`unknown option --${name} (it takes --port N and --no-open; the capture set, the reviewer and the grades file are chosen on the setup page)`)
    }
    if (port !== null) fail('--port was given more than once')
    // `--port N` as `trace:ui` takes it, or --port=N.
    const value = separator === -1 ? argv[++index] : argument.slice(separator + 1)
    const parsed = Number(value)
    if (value === undefined || value === '' || !Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
      fail(`--port needs an integer 0–65535, got ${JSON.stringify(value)}`)
    }
    port = parsed
  }
  return { port: port ?? DEFAULT_PORT, open }
}

function gitUserName(): string | null {
  try {
    const name = execFileSync('git', ['config', 'user.name'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return name === '' ? null : name
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

const { port, open } = parseArgv(process.argv.slice(2))

// The manifest `pnpm live:keys` would write, built from the same keys the
// bench puts beside each Answer — so the two cannot disagree.
let manifest: LiveKeyManifest
try {
  manifest = buildLiveKeyManifest()
} catch (error) {
  fail(`the key manifest could not be built from the keys: ${redactedMessage(error)}`)
}
const parsed = parseLiveKeyManifest(manifest)
if (!parsed.ok) fail(`the key manifest built from the keys is not valid:\n${parsed.errors.map((error) => `  - ${error}`).join('\n')}`)

const setup = openGradingSetup({
  artifactsRoot: LIVE_ARTIFACTS_ROOT,
  privateRoot: LIVE_PRIVATE_ROOT,
  manifest,
  keyFor: (huntId) => gradingKeyFor(huntId),
  defaultReviewer: gitUserName(),
  setupHtml: readFileSync(new URL('./live-review-setup.html', import.meta.url), 'utf8'),
  benchHtml: readFileSync(new URL('./live-review.html', import.meta.url), 'utf8'),
  onStart: (bench) => {
    console.log(`live:review grading capture set ${bench.setId} as ${bench.reviewer}`)
    console.log(`live:review grades: ${bench.gradesPath}`)
    console.log(`live:review drafts: ${bench.draftsPath}`)
  },
})

const server = createServer(setup.handle)
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') fail(`port ${port} is in use — pass --port N`)
  fail(`the server failed: ${error.message}`)
})
server.listen(port, '127.0.0.1', () => {
  const address = server.address()
  const bound = typeof address === 'object' && address !== null ? address.port : port
  const url = `http://127.0.0.1:${bound}/`
  console.log(`live:review setup at ${url} — choose a capture set and press Start`)
  if (open) openInBrowser(url)
})

function shutdown(): void {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 500).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
