import { mkdtemp } from 'node:fs/promises'
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { loadProductionEnv, resolveProductionRouting } from './eval/routing'
import { waitFor, sleep } from './waitFor'

// #221 AC2/AC3: the live replay, not a corpus scenario. The release corpus
// cannot express this — a scenario is one command plus at most one
// `followUp`, against the fixture server, and this is three commands in one
// Session against the live web. So it rides its own file and its own
// invocation, matched by no vitest config in the repo: the unit suite
// excludes `e2e/**/*.probe.test.ts`, `pnpm test:e2e` includes only
// `*.e2e.test.ts`, `pnpm test:eval` only `e2e/eval/**/*.eval.test.ts`, and
// `pnpm test:delegation` only `e2e/eval/**/*.probe.test.ts` (this file is
// one directory up, deliberately). It spends real model budget and must
// never ride a suite that runs unattended.
//
// So it is run by hand, with a config that lives outside the repo:
//
//   // /tmp/replay221.config.ts
//   import { defineConfig } from 'vitest/config'
//   export default defineConfig({
//     root: '<repo>',
//     test: { include: ['e2e/replay221.probe.test.ts'], testTimeout: 70 * 60_000, hookTimeout: 180_000 },
//   })
//
//   pnpm build && xvfb-run -a -s "-screen 0 1280x800x24" \
//     npx vitest run --config /tmp/replay221.config.ts
//
// It needs the repo `.env` (production routing) and the capture slot: one
// app at a time, nothing else driving Electron on the machine.
//
// The three commands are the ones session-d9fb240d actually received, read
// verbatim out of its trace (run-trace-1788869124041-1.jsonl). What that
// session did, and what this replay is judged against:
//
//   Run 1  17 rounds, longest round 10,705 reasoning chars
//   Run 2  17 rounds, longest round 10,238
//   Run 3   1 round, 20,319 chars, outcome `timeout`, no tool call at all
//
// Nothing here asserts the model's behaviour. Broken measurement fails (no
// routing, a run that never started); the numbers are recorded for the
// issue to read, exactly as the eval suite treats scenario success.

const COMMANDS = [
  'i found this reddit post about a manhwa tier list that i was using as a recommendations list on what to read next. help me find it again. i remember it had the boxer and horizon in the 10/10 tier. its not very recent, at the very least a year old',
  'Keep looking',
  "It's none of these keep looking",
] as const

/** Wall budget for one command before it is aborted and recorded as timed out. */
const RUN_TIMEOUT_MS = 20 * 60_000

interface RunRecord {
  index: number
  command: string
  turnId: string
  timedOut: boolean
  elapsedMs: number
}

describe('#221 live replay of session-d9fb240d', () => {
  let harness: Harness
  let userDataDir: string
  const runs: RunRecord[] = []

  beforeAll(async () => {
    // Fail fast, before any Electron launch or model spend.
    const routing = resolveProductionRouting(await loadProductionEnv())
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-replay221-'))
    harness = await startHarness({ userDataDir, env: routing.env })
    await harness.dashboardEval(`
      (() => {
        if (!window.__replayTapeInstalled) {
          window.__replayTapeInstalled = true
          window.__replayTape = []
          window.bingbong.assistant.onEvent((event) => { window.__replayTape.push(event) })
        }
        return window.__replayTape.length
      })()
    `)
  }, 180_000)

  afterAll(async () => {
    // The trace is the deliverable: copy it out of the throwaway profile
    // before the harness tears the profile down.
    try {
      const outDir = join(process.cwd(), 'e2e', 'replay-221')
      mkdirSync(outDir, { recursive: true })
      const logsDir = join(userDataDir, 'logs')
      for (const name of readdirSync(logsDir).filter((file) => file.startsWith('run-trace-'))) {
        copyFileSync(join(logsDir, name), join(outDir, name))
      }
      writeFileSync(join(outDir, 'runs.json'), `${JSON.stringify(runs, null, 2)}\n`)
    } catch (error) {
      console.error('[replay221] could not save the trace:', error)
    }
    await harness?.quit()
  }, 120_000)

  const doneArrived = (turnId: string): Promise<boolean> =>
    harness.dashboardEval<boolean>(
      `(window.__replayTape ?? []).some((event) => event.type === 'done' && event.turnId === ${JSON.stringify(turnId)})`,
    )

  async function awaitRun(index: number, command: string): Promise<void> {
    const submittedAt = Date.now()
    const submitted = await harness.submitCommand(command)
    if (submitted !== 'submitted') throw new Error(`command was not submitted: ${submitted}`)

    const turnId = await waitFor(
      async () => {
        const found = await harness.dashboardEval<string | null>(`
          (window.__replayTape ?? []).find(
            (event) => event.type === 'command' && event.text === ${JSON.stringify(command)} && event.at >= ${submittedAt - 2000},
          )?.turnId ?? null
        `)
        return found ?? undefined
      },
      { timeoutMs: 60_000, intervalMs: 250 },
    )

    let timedOut = false
    try {
      await waitFor(async () => ((await doneArrived(turnId)) ? true : undefined), {
        timeoutMs: RUN_TIMEOUT_MS,
        intervalMs: 500,
      })
    } catch {
      timedOut = true
      await harness.dashboardEval('window.bingbong.assistant.abort()')
      await waitFor(async () => ((await doneArrived(turnId)) ? true : undefined), {
        timeoutMs: 60_000,
        intervalMs: 500,
      }).catch(() => {})
    }
    // Let the run's terminal bookkeeping (summary span, memory commit) land.
    await sleep(1_000)
    runs.push({ index, command, turnId, timedOut, elapsedMs: Date.now() - submittedAt })
    console.log(`[replay221] run ${index} (${turnId}) settled in ${Date.now() - submittedAt}ms, timedOut=${timedOut}`)
  }

  it('replays the three commands in one Session', async () => {
    for (const [index, command] of COMMANDS.entries()) {
      await awaitRun(index + 1, command)
    }
    // Broken measurement is the only failure: three Runs have to have run.
    expect(runs).toHaveLength(3)
    expect(new Set(runs.map((run) => run.turnId)).size).toBe(3)
  }, 70 * 60_000)
})
