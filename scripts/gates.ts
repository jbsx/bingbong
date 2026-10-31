#!/usr/bin/env node
// `pnpm gates` (#544): every opt-in gate that needs no paid key, run once, one
// line each, so a gate gone stale is seen in the batch that made it stale. Muted
// (the harness mutes every launch; speechEcho plays only into its closed room),
// no Jev. Exits 0 only when every gate ran and passed. Each gate's whole output
// and the numbers it measured stay in the folder the last line names. The app is
// built once by the package script; e2e/gates.ts holds the list and the verdict.
// Node runs this .ts directly via type stripping (#36).

import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GATES, gateLine, gateVerdict, type Gate, type VitestReport } from '../e2e/gates.ts'

/** Past any gate's own tests' timeouts: this catches a run that hangs, so one gate cannot hold the batch. */
const GATE_TIMEOUT_MS = 20 * 60_000

const dir = mkdtempSync(join(tmpdir(), 'bingbong-gates-'))

function run(gate: Gate): Promise<{ code: number | null; timedOut: boolean }> {
  const reportFile = join(dir, `${gate.name}.report.json`)
  const log = createWriteStream(join(dir, `${gate.name}.log`))
  const child = spawn(
    'e2e/bin/no-network.sh',
    ['xvfb-run', '-a', '-s', '-screen 0 1280x800x24', 'vitest', 'run', '--config', 'vitest.e2e.config.ts', '--reporter=default', '--reporter=json', `--outputFile.json=${reportFile}`, gate.file],
    { env: { ...process.env, ...gate.env(dir) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  )
  child.stdout.pipe(log, { end: false })
  child.stderr.pipe(log, { end: false })
  // Its own process group: xvfb-run, vitest and the app under them go together.
  const stop = (): void => {
    if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL')
  }
  const stopped = (): void => {
    stop()
    process.exit(1)
  }
  process.once('SIGINT', stopped)
  process.once('SIGTERM', stopped)
  return new Promise((resolve) => {
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, GATE_TIMEOUT_MS)
    const done = (code: number | null): void => {
      clearTimeout(timer)
      process.off('SIGINT', stopped)
      process.off('SIGTERM', stopped)
      log.end()
      resolve({ code, timedOut })
    }
    child.once('error', () => done(null))
    child.once('close', done)
  })
}

function readReport(gate: Gate): VitestReport | null {
  const file = join(dir, `${gate.name}.report.json`)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as VitestReport
  } catch {
    return null
  }
}

let red = 0
for (const gate of GATES) {
  const started = Date.now()
  const exit = await run(gate)
  const verdict = gateVerdict(readReport(gate), exit)
  if (!verdict.green) red += 1
  process.stdout.write(`${gateLine(gate.name, verdict, (Date.now() - started) / 1000)}\n`)
}
process.stdout.write(`${GATES.length - red} of ${GATES.length} gates passed; logs and numbers in ${dir}\n`)
process.exitCode = red === 0 ? 0 : 1
