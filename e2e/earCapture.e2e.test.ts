import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { afterAll, describe, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { appProcesses, cpuTicks, percentOfCore, threadTicks } from './processCpu'
import { waitFor } from './waitFor'

// The ear on a real capture graph (#431): Chromium's fake mic
// (--use-fake-device-for-media-stream) feeds the dashboard's capture context
// and worklet, and the frames reach the main process's wake monitor. The
// scripted wake advances one score per 1280-sample chunk, so its firing
// says the frames arrived. (Their rate and values are the unit suite's:
// micCapture.test.ts.)
//
// Opt-in beside it: the ear at rest, per process and per audio thread, the
// measure #431's arms were decided on. Meant for a constrained run standing
// in for the kiosk's i3:
//
//   pnpm build && BINGBONG_EAR_CPU=$PWD/ear-cpu.json \
//     systemd-run --user --scope -p CPUQuota=120% taskset -c 0,1 \
//     xvfb-run -a -s '-screen 0 1920x1080x24' vitest run --config vitest.e2e.config.ts e2e/earCapture.e2e.test.ts
//
// BINGBONG_EAR_PULSE_SERVER points the app at a private, sink-less-to-speakers
// pulseaudio (a null sink) so its streams and its own CPU are in the numbers
// too (BINGBONG_EAR_PULSE_PID); unset, the app keeps the session's dead PULSE_SERVER.

// BINGBONG_EAR_PULSE_MIC=1 (with the private pulse) hears its default source instead of the fake mic: a null sink's
// monitor, set at the kiosk C920's 32 kHz, so the source-output and pulse's resample are in the numbers.
const FAKE_MIC = process.env.BINGBONG_EAR_PULSE_MIC === '1' ? ['--use-fake-ui-for-media-stream'] : ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
const QUIET_CHUNKS = 50

const out = process.env.BINGBONG_EAR_CPU
const pulseServer = process.env.BINGBONG_EAR_PULSE_SERVER
const pulsePid = process.env.BINGBONG_EAR_PULSE_PID
const SAMPLE_S = 20

const monitoringHint = async (harness: Harness): Promise<true | undefined> =>
  (await harness.dashboardEval<boolean>(`!!document.querySelector('.voice-hint--monitoring')`)) || undefined

describe('ear capture e2e (#431)', () => {
  it('hears the fake mic and fires the wake', async () => {
    const harness = await startHarness({
      launchArgs: FAKE_MIC,
      env: {
        BINGBONG_WAKE_ENGINE: 'node',
        BINGBONG_WAKE_SCRIPT: JSON.stringify([...Array.from({ length: QUIET_CHUNKS }, () => 0.01), 0.99, 0.01]),
        // Speech for the wake's VAD gate throughout; the Silero model is not in a test profile.
        BINGBONG_VAD_SCRIPT: JSON.stringify([0.95]),
        ...(pulseServer ? { PULSE_SERVER: pulseServer } : {}),
      },
    })
    try {
      await waitFor(() => monitoringHint(harness), { timeoutMs: 20000, intervalMs: 100 })
      // The scripted wake fires on the 51st 1280-sample chunk the main process takes from the capture.
      await waitFor(async () => (await harness.dashboardEval<boolean>(`!!document.querySelector('.status-orb--listening')`)) || undefined, {
        timeoutMs: 30000,
        intervalMs: 100,
      })
    } finally {
      await harness.quit()
    }
  }, 90000)
})

describe.skipIf(!out)('ear at rest cpu (constrained run)', () => {
  let harness: Harness | undefined
  const numbers: Record<string, unknown> = {}

  afterAll(async () => {
    if (out) await writeFile(out, `${JSON.stringify(numbers, null, 2)}\n`)
    await harness?.quit()
  })

  const pactl = (what: string): string => {
    try {
      return execFileSync('pactl', ['list', 'short', what], { encoding: 'utf8', env: { ...process.env, PULSE_SERVER: pulseServer } }).trim()
    } catch (error) {
      return `pactl failed: ${String(error)}`
    }
  }

  /** % of one core per app process, its audio-bearing threads, and the private pulse, over one window. */
  const sample = async (label: string): Promise<void> => {
    const processes = appProcesses()
    const watched = [...processes].filter(([, type]) => type === 'renderer' || type.includes('audio'))
    const before = new Map<number, number>()
    const beforeThreads = new Map<number, Map<string, number>>()
    for (const pid of processes.keys()) before.set(pid, await cpuTicks(pid))
    for (const [pid] of watched) beforeThreads.set(pid, await threadTicks(pid))
    const pulseBefore = pulsePid ? await cpuTicks(Number(pulsePid)) : 0
    await new Promise((resolve) => setTimeout(resolve, SAMPLE_S * 1000))
    const row: Record<string, number> = {}
    let total = 0
    for (const [pid, type] of processes) {
      const percent = percentOfCore((await cpuTicks(pid)) - before.get(pid)!, SAMPLE_S)
      if (percent >= 0.1) row[`${type}#${pid}`] = percent
      total += percent
    }
    row.total = Math.round(total * 10) / 10
    if (pulsePid) row.pulseaudio = percentOfCore((await cpuTicks(Number(pulsePid))) - pulseBefore, SAMPLE_S)
    const threads: Record<string, number> = {}
    for (const [pid, type] of watched) {
      const then = beforeThreads.get(pid)!
      for (const [thread, ticks] of await threadTicks(pid)) {
        const percent = percentOfCore(ticks - (then.get(thread) ?? 0), SAMPLE_S)
        if (percent >= 0.2) threads[`${type}#${pid} ${thread}`] = percent
      }
    }
    numbers[label] = { processes: row, threads }
  }

  it('the ear open at rest on the Idle Screen', async () => {
    harness = await startHarness({
      launchArgs: FAKE_MIC,
      wakeFromBootIdle: false,
      env: { BINGBONG_WAKE_ENGINE: 'node', BINGBONG_WAKE_SCRIPT: JSON.stringify([0.01]), BINGBONG_VAD_SCRIPT: JSON.stringify([0.01]), ...(pulseServer ? { PULSE_SERVER: pulseServer } : {}) },
    })
    await waitFor(async () => (await harness!.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)) || undefined, { timeoutMs: 15000, intervalMs: 250 })
    // Past the boot's own work on a constrained CPU, kept apart as in idleCpu.
    await new Promise((resolve) => setTimeout(resolve, 12_000))
    if (pulseServer) numbers.pulse = { sinkInputs: pactl('sink-inputs'), sourceOutputs: pactl('source-outputs') }
    await sample('boot tail')
    await sample('ear at rest')
    await sample('ear at rest, again')
  }, 240_000)
})
