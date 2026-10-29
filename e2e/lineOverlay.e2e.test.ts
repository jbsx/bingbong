import { execSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { cli } from './cliSupport'
import { waitFor } from './waitFor'

// The Line Overlay (#513): with the voice off — the default — every line the
// app would have said is shown big on whatever surface is up and marked by a
// chime. Over the browsing pane it is its own view; on the Idle Screen and
// over Settings the dashboard draws it. Status type at 65 px, up 15 s or
// until the next line, read and never acted on: it never keeps focus.

const SHOT_DIR = process.env.BINGBONG_STATE_SHOT_DIR ?? join(tmpdir(), 'bingbong-line-overlay-shots')
/** A line chime as the scripted aplay logs it: two 120 ms tones at 16 kHz, 7724 bytes with the header. */
const LINE_CHIME = 'bytes=7724'
const PANE_TEXT = `document.querySelector('.line-overlay-text')?.textContent ?? ''`

describe('the Line Overlay e2e (#513)', () => {
  let harness: Harness
  let dir: string
  let log: string

  /** The whole screen as Xvfb draws it, the overlay's view composited over the pane, and the view alone when it is up. */
  async function shoot(name: string, view: boolean): Promise<void> {
    await mkdir(SHOT_DIR, { recursive: true })
    if (view) await writeFile(join(SHOT_DIR, `${name}-view.png`), await harness.lineOverlayShot())
    try {
      execSync(`xwd -root -silent | ffmpeg -loglevel error -y -f xwd_pipe -i - '${join(SHOT_DIR, `${name}-screen.png`)}'`)
    } catch {
      // No xwd or ffmpeg here: the view's own shot stands.
    }
  }

  const chimes = async (): Promise<number> => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter((row) => row.startsWith('aplay') && row.endsWith(LINE_CHIME)).length
  const spoken = async (): Promise<string[]> => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter((row) => row.startsWith('piper-line'))
  /** The middle of the pane's overlay slot, where a click on the overlay's view lands. */
  const slot = (): Promise<{ x: number; y: number }> =>
    harness.dashboardEval(`(() => { const r = document.querySelector('.lineoverlay-slot').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bingbong-line-overlay-e2e-'))
    log = join(dir, 'tts.log')
    // A voice for the scripted piper: were the app to speak, it could, and the log would say so.
    const voices = join(dir, 'voices')
    await mkdir(voices)
    await writeFile(join(voices, 'en_GB-alba-medium.onnx'), '')
    await writeFile(join(voices, 'en_GB-alba-medium.onnx.json'), JSON.stringify({ audio: { sample_rate: 22050 } }))
    harness = await startHarness({
      launchArgs: ['--browser-cli'],
      pipeStdio: true,
      env: { BINGBONG_PIPER_VOICE_DIR: voices, BINGBONG_FAKE_TTS_LOG: log },
    })
    await harness.waitForCliOutput(/bingbong browser harness/)
  })

  afterAll(async () => {
    await harness?.quit()
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  it('over the pane: a failure shown at 65 px with its chime, never spoken, never focused, the next line in its place, gone 15 s on', async () => {
    await cli(harness, `navigate ${harness.fixture.url('/landing/missing')}`, /^navigated: /)
    await waitFor(async () => ((await harness.lineOverlayEval<string>(PANE_TEXT)).startsWith("That page doesn't exist.") ? true : undefined), { timeoutMs: 10_000, intervalMs: 100 })
    expect(await harness.lineOverlayEval<boolean>(`!!document.querySelector('.line-overlay--failed')`)).toBe(true)
    expect(await harness.lineOverlayEval<number>(`parseFloat(getComputedStyle(document.querySelector('.line-overlay-text')).fontSize)`)).toBeGreaterThanOrEqual(65)
    const up = await slot()
    await shoot('line-overlay-pane-failed', true)
    await waitFor(async () => ((await chimes()) >= 1 ? true : undefined), { timeoutMs: 10_000, intervalMs: 100 })

    // Read, never acted on: a real click on the overlay leaves it unfocused.
    execSync(`xdotool mousemove ${up.x} ${up.y} click 1`)
    await sleep(500)
    expect(await harness.lineOverlayEval<boolean>('document.hasFocus()')).toBe(false)

    // The next line takes its place, a done line out of the failure's colour, with its own chime.
    harness.cliWrite('mark as failure')
    await waitFor(async () => ((await harness.lineOverlayEval<string>(PANE_TEXT)) === 'Flagged.' ? true : undefined), { timeoutMs: 10_000, intervalMs: 100 })
    const shownAt = Date.now()
    expect(await harness.lineOverlayEval<boolean>(`!!document.querySelector('.line-overlay--failed')`)).toBe(false)
    await shoot('line-overlay-pane-done', true)
    await waitFor(async () => ((await chimes()) >= 2 ? true : undefined), { timeoutMs: 10_000, intervalMs: 100 })

    // Up 15 s from that line, then gone: the view draws nothing.
    await sleep(13_000 - (Date.now() - shownAt))
    expect(await harness.lineOverlayEval<string>(PANE_TEXT)).toBe('Flagged.')
    await waitFor(async () => ((await harness.lineOverlayEval<string>(PANE_TEXT)) === '' ? true : undefined), { timeoutMs: 5_000, intervalMs: 100 })
    expect(Date.now() - shownAt).toBeGreaterThanOrEqual(14_500)
    expect(await spoken()).toEqual([])
  }, 60_000)

  it('over Settings the dashboard draws it', async () => {
    await harness.clickDashboardElement('.settings-toggle')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.settings-page')`)) ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
    harness.cliWrite('mark as failure')
    const text = `document.querySelector('.lineoverlay-place .line-overlay-text')?.textContent ?? ''`
    await waitFor(async () => ((await harness.dashboardEval<string>(text)) === 'Flagged.' ? true : undefined), { timeoutMs: 10_000, intervalMs: 100 })
    expect(await harness.dashboardEval<number>(`parseFloat(getComputedStyle(document.querySelector('.lineoverlay-place .line-overlay-text')).fontSize)`)).toBeGreaterThanOrEqual(65)
    await shoot('line-overlay-settings', false)
    await harness.clickDashboardElement('.settings-actions .settings-button:not(.settings-button--primary)')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.settings-page')`)) ? undefined : true), { timeoutMs: 10_000, intervalMs: 250 })
  }, 30_000)

  it('on the Idle Screen it comes up over the foot, and the screen stays up', async () => {
    await harness.clickDashboardElement('.idle-toggle')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)) ? true : undefined), { timeoutMs: 10_000, intervalMs: 250 })
    harness.cliWrite('mark as failure')
    const text = `document.querySelector('.idle-screen .idle-line-place .line-overlay-text')?.textContent ?? ''`
    await waitFor(async () => ((await harness.dashboardEval<string>(text)) === 'Flagged.' ? true : undefined), { timeoutMs: 10_000, intervalMs: 100 })
    expect(await harness.dashboardEval<number>(`parseFloat(getComputedStyle(document.querySelector('.idle-line-place .line-overlay-text')).fontSize)`)).toBeGreaterThanOrEqual(65)
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.idle-screen')`)).toBe(true)
    await shoot('line-overlay-idle', false)
    expect(await spoken()).toEqual([])
  }, 30_000)
})
