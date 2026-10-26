import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { startHarness, type Harness } from './harness'
import { cli } from './cliSupport'
import { appProcesses, cpuTicks, percentOfCore } from './processCpu'
import { decisionScript, readingOf } from './scriptedJev'
import { waitFor } from './waitFor'

// What a song under the Idle Screen costs, per app process (2026-10-25: the
// kiosk's fans ran while the window was on screen and eased when i3 hid it).
// Measured, not asserted. Opt-in, and meant for a constrained run standing in
// for the kiosk's i3 at its size:
//
//   pnpm build && BINGBONG_IDLE_CPU=$PWD/idle-cpu.json \
//     systemd-run --user --scope -p CPUQuota=120% taskset -c 0,1 \
//     xvfb-run -a -s '-screen 0 1920x1080x24' vitest run --config vitest.e2e.config.ts e2e/idleCpu.e2e.test.ts
//
// The numbers (% of one core, by process type) land in the file the variable names.

const out = process.env.BINGBONG_IDLE_CPU
const SAMPLE_S = 20

describe.skipIf(!out)('idle screen cpu with a song (constrained run)', () => {
  let harness: Harness
  let fixture: FixtureServer
  let userDataDir: string
  const numbers: Record<string, Record<string, number>> = {}

  /** % of one core each process used over the sample, keyed `type#pid`, with the total. */
  const sample = async (label: string): Promise<void> => {
    const processes = appProcesses()
    const before = new Map<number, number>()
    for (const pid of processes.keys()) before.set(pid, await cpuTicks(pid))
    await new Promise((resolve) => setTimeout(resolve, SAMPLE_S * 1000))
    const row: Record<string, number> = {}
    let total = 0
    for (const [pid, type] of processes) {
      const percent = percentOfCore((await cpuTicks(pid)) - before.get(pid)!, SAMPLE_S)
      if (percent >= 0.1) row[`${type}#${pid}`] = percent
      total += percent
    }
    row.total = Math.round(total * 10) / 10
    numbers[label] = row
  }

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-idle-cpu-'))
    fixture = await startFixtureServer()
    harness = await startHarness({
      userDataDir,
      fixture,
      wakeFromBootIdle: false,
      launchArgs: ['--browser-cli', '--mute-audio'],
      pipeStdio: true,
      env: { BINGBONG_YOUTUBE_FIXTURE: new URL(fixture.url('/')).origin, ...decisionScript(readingOf('play fixture song')) },
    })
    await harness.waitForCliOutput(/bingbong browser harness/)
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)) ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
  }, 120_000)

  afterAll(async () => {
    if (out) await writeFile(out, `${JSON.stringify(numbers, null, 2)}\n`)
    await harness?.quit()
    await fixture?.close().catch(() => {})
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('a song playing under the Idle Screen', async () => {
    await cli(harness, 'play fixture song', /^(playing: id=|No videos|.*can't be played|YouTube didn't|error:)/)
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-music-card--playing')`)) ? true : undefined), { timeoutMs: 15_000, intervalMs: 250 })
    // Past the Task's park and Chromium's ten seconds before a hidden page's video stops decoding. The first sample still holds
    // the boot's own work on a constrained CPU (17 % of a core in the browser process on 2026-10-25), so it is kept apart.
    await new Promise((resolve) => setTimeout(resolve, 12_000))
    await sample('boot tail')
    await sample('song under the Idle Screen')
    await sample('song under the Idle Screen, again')
  }, 240_000)
})
