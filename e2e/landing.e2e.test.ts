import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { cli } from './cliSupport'
import { waitFor } from './waitFor'

// A landing is the page gone DOM-quiet, not the load event (#328, ADR 0076
// amendment). Each fixture page holds its load open with an image whose
// response never ends: the navigate lands at dom-ready and a quiet window
// on a page that goes quiet, at the 3 s cap on one that never does — the
// decision record says which — and a not-found page is still read as the
// wall it is on that collect, its line spoken.

describe('the landing wait e2e', () => {
  let harness: Harness
  let dir: string
  let log: string

  /** The decision record a typed line wrote. */
  async function recordOf(line: string): Promise<Record<string, unknown>> {
    const logs = join(harness.userDataDir, 'logs')
    return waitFor(
      async () => {
        const files = (await readdir(logs).catch(() => [] as string[])).filter((file) => file.startsWith('decision-'))
        for (const file of files) {
          for (const row of (await readFile(join(logs, file), 'utf8')).split('\n')) {
            if (row === '') continue
            const record = JSON.parse(row) as Record<string, unknown>
            if (record.type === 'decision' && record.transcript === line) return record
          }
        }
        return undefined
      },
      { timeoutMs: 10_000, intervalMs: 100 },
    )
  }

  /** Runs a navigate and answers how long its outcome line took. */
  async function timedNavigate(path: string): Promise<{ line: string; ms: number }> {
    const line = `navigate ${harness.fixture.url(path)}`
    const started = Date.now()
    await cli(harness, line, /^navigated: /)
    return { line, ms: Date.now() - started }
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bingbong-landing-e2e-'))
    log = join(dir, 'tts.log')
    const voices = join(dir, 'voices')
    await mkdir(voices)
    await writeFile(join(voices, 'en_US-ryan-medium.onnx'), '')
    await writeFile(join(voices, 'en_US-ryan-medium.onnx.json'), JSON.stringify({ audio: { sample_rate: 22050 } }))
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

  it('lands on dom-ready and a quiet window while the load event is held open', async () => {
    const { line, ms } = await timedNavigate('/landing/held')
    // The load never ends; before #328 this waited out the 30 s bound.
    expect(ms).toBeLessThan(2_500)
    expect(await recordOf(line)).toMatchObject({ verb: 'open', landing: 'quiet' })
    expect(await harness.paneEval('document.readyState')).not.toBe('complete')
  })

  it('takes a page that never goes quiet as it stands at the 3 s cap, and records the landing capped', async () => {
    const { line, ms } = await timedNavigate('/landing/busy')
    expect(ms).toBeGreaterThanOrEqual(2_900)
    expect(ms).toBeLessThan(6_000)
    expect(await recordOf(line)).toMatchObject({ verb: 'open', landing: 'capped' })
  })

  it('still reads a not-found landing as the wall it is, and speaks its line', async () => {
    const { line, ms } = await timedNavigate('/landing/missing')
    expect(ms).toBeLessThan(2_500)
    expect(await recordOf(line)).toMatchObject({ landing: 'quiet' })
    await waitFor(
      async () => ((await readFile(log, 'utf8').catch(() => '')).split('\n').includes("piper-line That page doesn't exist.") ? true : undefined),
      { timeoutMs: 10_000, intervalMs: 100 },
    )
  })
})
