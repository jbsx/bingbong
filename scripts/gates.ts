#!/usr/bin/env node
// `pnpm gates` (#544): the opt-in gates that need no paid key, run once, one line
// each, so a gate gone stale is seen in the batch that made it stale. Muted (the
// harness mutes every launch; speechEcho plays only into its closed room), no
// Jev. Exits 0 only when every gate ran and passed. Each gate's whole output and
// what it measured stay in the folder the last line names; those numbers come
// from this machine as it stands, not the constrained run a gate's header
// describes, so they say the gate works and do not compare with the kiosk's. The
// app is built once by the package script; e2e/gates.ts holds the list and the
// verdict. Node runs this .ts directly via type stripping (#36).

import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GATES, gateEnv, gateLine, gateVerdict, type Gate, type VitestReport } from '../e2e/gates.ts'

const dir = mkdtempSync(join(tmpdir(), 'bingbong-gates-'))

/**
 * One gate under `timeout`, which leads a process group of its own and answers for all of it: past any test's own
 * timeout it stops a run that hangs, so one gate cannot hold the batch, and it does so even if this script is killed.
 * A term first, so vitest's hooks and xvfb-run's trap clean up. A signal passed to it goes to the whole group too.
 */
function run(gate: Gate, logFile: string, reportFile: string): Promise<{ code: number | null; timedOut: boolean }> {
  const log = openSync(logFile, 'w')
  const child = spawn(
    'timeout',
    ['-k', '20', '20m', 'e2e/bin/no-network.sh', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', 'vitest', 'run', '--config', 'vitest.e2e.config.ts', '--reporter=default', '--reporter=json', `--outputFile.json=${reportFile}`, gate.file],
    { env: gateEnv(gate, dir, process.env), stdio: ['ignore', log, log] },
  )
  closeSync(log)
  const stopped = (): void => {
    child.kill('SIGTERM')
    process.exit(1)
  }
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
  for (const signal of signals) process.once(signal, stopped)
  return new Promise((resolve) => {
    const done = (code: number | null): void => {
      for (const signal of signals) process.off(signal, stopped)
      // 124: timeout's term ended it; 137: its kill had to.
      resolve({ code, timedOut: code === 124 || code === 137 })
    }
    child.once('error', () => done(null))
    child.once('close', done)
  })
}

function readReport(file: string): VitestReport | null {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as VitestReport
  } catch {
    return null
  }
}

let red = 0
for (const gate of GATES) {
  const logFile = join(dir, `${gate.name}.log`)
  const reportFile = join(dir, `${gate.name}.report.json`)
  const started = Date.now()
  const exit = await run(gate, logFile, reportFile)
  const verdict = gateVerdict(readReport(reportFile), exit, readFileSync(logFile, 'utf8'))
  if (!verdict.green) red += 1
  process.stdout.write(`${gateLine(gate.name, verdict, (Date.now() - started) / 1000)}\n`)
}
process.stdout.write(`${GATES.length - red} of ${GATES.length} gates passed; logs and numbers in ${dir}\n`)
process.exitCode = red === 0 ? 0 : 1
