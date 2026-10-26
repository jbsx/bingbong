import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PerfSpanRecord } from '../src/core/perf/perfTracer'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// The hearing receipt (#441, UI principle 1): from the frame speech starts
// in to the screen saying the ear has it, under 100 ms, on the Idle Screen's
// Voice Line and on the Voice Prompt. Chromium's fake mic feeds the real
// capture graph at the mic's own pace; the scripts stand in for the models,
// one VAD score per 512-sample frame: a wake, about two seconds of quiet in
// the open listen, then speech the endpointer confirms.
// The onset is main's: the `speech-to-hearing` span runs from the arrival of
// the chunk speech started in to the dashboard's painted receipt, and its end
// less its length is the onset the Voice Prompt's paint is timed from.

const SPEECH = 0.95
const QUIET = 0.01
const BAR_MS = 100
const frames = (prob: number, count: number): number[] => Array.from({ length: count }, () => prob)

const ear = {
  BINGBONG_WAKE_ENGINE: 'node',
  BINGBONG_WAKE_SCRIPT: JSON.stringify([QUIET, QUIET, QUIET, 0.99, QUIET]),
  // Speech for the wake's gate, quiet in the open listen, then the Utterance: no transcript, so nothing fires.
  BINGBONG_VAD_SCRIPT: JSON.stringify([...frames(SPEECH, 12), ...frames(QUIET, 60), ...frames(SPEECH, 40), QUIET]),
  BINGBONG_STT_SCRIPT: '[]',
}

/** Stamps, on the view's own clock as epoch ms, the frame after `selector` first matches. */
const stampPaint = (selector: string): string => `(() => {
  window.__receipt = null
  const mark = () => {
    if (window.__receipt !== null || !document.querySelector(${JSON.stringify(selector)})) return
    window.__receipt = 0
    requestAnimationFrame(() => setTimeout(() => { window.__receipt = performance.timeOrigin + performance.now() }, 0))
  }
  new MutationObserver(mark).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
})()`

// Opt-in: the screen as the receipt shows, beside the states shots (`stateShots` names the folder).
const SHOT_DIR = process.env.BINGBONG_STATE_SHOT_DIR
function shoot(name: string): void {
  if (!SHOT_DIR) return
  mkdirSync(SHOT_DIR, { recursive: true })
  execSync(`xwd -root -silent | ffmpeg -loglevel error -y -f xwd_pipe -i - '${join(SHOT_DIR, `${name}.png`)}'`)
}

const FAKE_MIC = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']

async function hearingSpans(harness: Harness): Promise<PerfSpanRecord[]> {
  const logsDir = join(harness.userDataDir, 'logs')
  const files = (await readdir(logsDir).catch(() => [] as string[])).filter((name) => name.startsWith('perf-'))
  return (await Promise.all(files.map((name) => readFile(join(logsDir, name), 'utf8'))))
    .join('')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as PerfSpanRecord)
    .filter((record) => record.stage === 'speech-to-hearing')
}

/** Wake the ear, speak into it, and read the receipt: main's span, and the epoch the given view painted it. */
async function receipt(harness: Harness, view: 'dashboard' | 'overlay', selector: string): Promise<{ span: PerfSpanRecord; paintMs: number }> {
  const evaluate = <T,>(expression: string): Promise<T> => (view === 'dashboard' ? harness.dashboardEval<T>(expression) : harness.overlayEval<T>(expression))
  // The gate's speech fires the scripted wake at its fourth 1280-sample chunk; the quiet after it is the time to watch.
  await waitFor(async () => ((await harness.dashboardEval<{ listening: boolean }>('window.bingbong.voice.getState()')).listening ? true : undefined), { timeoutMs: 30_000, intervalMs: 20 })
  await evaluate(stampPaint(selector))
  await waitFor(async () => ((await evaluate<number | null>('window.__receipt')) ? true : undefined), { timeoutMs: 20_000, intervalMs: 20 })
  const span = await waitFor(async () => (await hearingSpans(harness))[0], { timeoutMs: 5_000, intervalMs: 50 })
  return { span, paintMs: (await evaluate<number>('window.__receipt'))! }
}

describe('the hearing receipt (#441)', () => {
  it('the Idle Screen says the ear hears within 100 ms of the frame speech starts in', async () => {
    const harness = await startHarness({ wakeFromBootIdle: false, launchArgs: FAKE_MIC, env: ear })
    try {
      await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)) ? true : undefined), { timeoutMs: 20_000, intervalMs: 100 })
      const { span, paintMs } = await receipt(harness, 'dashboard', '.idle-voice--hearing')
      const onset = span.at - span.durMs
      console.log(`[hearing receipt] Idle Screen: span ${span.durMs.toFixed(1)} ms, paint ${(paintMs - onset).toFixed(1)} ms after onset`)
      expect(span.durMs).toBeLessThan(BAR_MS)
      expect(paintMs - onset).toBeLessThan(BAR_MS)
      expect(await harness.dashboardEval<string>(`document.querySelector('.idle-voice-said')?.textContent ?? ''`)).toBe('…')
      shoot('41-idle-hearing')
    } finally {
      await harness.quit()
    }
  }, 90_000)

  it('the Voice Prompt says the ear hears within 100 ms of the frame speech starts in', async () => {
    const harness = await startHarness({ launchArgs: FAKE_MIC, env: ear })
    try {
      await harness.ensurePanelOpen()
      await waitFor(async () => ((await harness.overlayEval<boolean>(`!!document.querySelector('.voice-prompt')`)) ? true : undefined), { timeoutMs: 20_000, intervalMs: 100 })
      const { span, paintMs } = await receipt(harness, 'overlay', '.voice-prompt--hearing')
      const onset = span.at - span.durMs
      console.log(`[hearing receipt] Voice Prompt: span ${span.durMs.toFixed(1)} ms, paint ${(paintMs - onset).toFixed(1)} ms after onset`)
      expect(paintMs - onset).toBeLessThan(BAR_MS)
      // Hearing with no words yet is an honest empty line (#454): no "…", the partial the line that grows.
      expect(await harness.overlayEval<string>(`document.querySelector('.voice-prompt-said')?.textContent ?? ''`)).toBe('')
      expect(await harness.overlayEval<string>(`document.querySelector('.voice-prompt-state')?.textContent ?? ''`)).toBe('Listening…')
      shoot('41-voice-prompt-hearing')
    } finally {
      await harness.quit()
    }
  }, 90_000)
})
