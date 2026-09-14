#!/usr/bin/env node
// The Fix Ledger entry point (`pnpm live:ledger`, #251): a loopback-only
// server for one page that reads the Round Audits in a reports directory
// and shows what every capture set changed against its Reference — the
// improvements from a Baseline, on one page instead of across two aggregate
// audits read by hand.
//
// It is a script beside `pnpm live:review` and `pnpm trace:ui`, never an app
// view: evaluator material is not rendered in any view (glossary, Fix
// Ledger), and nothing electron-vite bundles reaches this file. It reads
// audit JSON and Markdown only — no capture, no grades file, no key — and
// writes nothing. Node runs this .ts directly via type stripping (Node ≥
// 22.18), so every runtime import on its graph carries a .ts extension.
//
// Usage:
//   pnpm live:ledger [--reports=<dir>] [--port N] [--no-open]
//
// Without --reports it reads e2e/live/reports, where the audits are
// committed. The page reads the directory on load; reload to re-read.

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openFixLedger } from '../e2e/live/ledgerServer.ts'

const DEFAULT_PORT = 4251
const DEFAULT_REPORTS_DIR = fileURLToPath(new URL('../e2e/live/reports/', import.meta.url))

function fail(message: string): never {
  process.stderr.write(`live:ledger: ${message}\n`)
  process.exit(1)
}

function parseArgv(argv: readonly string[]): { reportsDir: string; port: number; open: boolean } {
  let port: number | null = null
  let reportsDir: string | null = null
  let open = true
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!
    if (argument === '--no-open') {
      open = false
      continue
    }
    if (!argument.startsWith('--')) fail(`unexpected argument "${argument}" — it takes --reports=<dir>, --port N and --no-open`)
    const separator = argument.indexOf('=')
    const name = separator === -1 ? argument.slice(2) : argument.slice(2, separator)
    // `--port N` as `trace:ui` takes it, or --port=N; the same for --reports.
    const value = separator === -1 ? argv[++index] : argument.slice(separator + 1)
    if (name === 'port') {
      if (port !== null) fail('--port was given more than once')
      const parsed = Number(value)
      if (value === undefined || value === '' || !Number.isInteger(parsed) || parsed < 0 || parsed > 65535) fail(`--port needs an integer 0–65535, got ${JSON.stringify(value)}`)
      port = parsed
      continue
    }
    if (name === 'reports') {
      if (reportsDir !== null) fail('--reports was given more than once')
      if (value === undefined || value === '') fail('--reports needs a directory')
      reportsDir = resolve(value)
      continue
    }
    fail(`unknown option --${name} (it takes --reports=<dir>, --port N and --no-open)`)
  }
  return { reportsDir: reportsDir ?? DEFAULT_REPORTS_DIR, port: port ?? DEFAULT_PORT, open }
}

function openInBrowser(url: string): void {
  const [command, commandArgs] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
  try {
    const child = spawn(command, commandArgs, { stdio: 'ignore', detached: true })
    child.on('error', () => console.log(`live:ledger could not open a browser; open ${url} yourself`))
    child.unref()
  } catch (error) {
    console.log(`live:ledger could not open a browser (${String(error)}); open ${url} yourself`)
  }
}

const { reportsDir, port, open } = parseArgv(process.argv.slice(2))

const ledger = openFixLedger({
  reportsDir,
  pageHtml: readFileSync(new URL('./live-ledger.html', import.meta.url), 'utf8'),
})
const first = ledger.read()
if (first.families.length === 0) console.log(`live:ledger found no Round Audit (audit-*.json) in ${reportsDir}`)
for (const ignored of first.ignored) console.log(`live:ledger ignored ${ignored.name}: ${ignored.reason}`)

const server = createServer(ledger.handle)
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') fail(`port ${port} is in use — pass --port N`)
  fail(`the server failed: ${error.message}`)
})
server.listen(port, '127.0.0.1', () => {
  const address = server.address()
  const bound = typeof address === 'object' && address !== null ? address.port : port
  const url = `http://127.0.0.1:${bound}/`
  console.log(`live:ledger reading ${reportsDir} (${first.families.length} famil${first.families.length === 1 ? 'y' : 'ies'})`)
  console.log(`live:ledger at ${url}`)
  if (open) openInBrowser(url)
})

function shutdown(): void {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 500).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
