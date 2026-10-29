import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { cli } from './cliSupport'
import { waitFor } from './waitFor'

// BINGBONG_SPEECH_PLAYER=chromium (#490): the app's voice plays in a hidden
// window's WebAudio, so the mic's echo canceller hears it. `read` speaks the
// Page Read through it end to end, aplay is never started, the chime is not
// either, and the pane — the page the media collector, the pane duck and the
// Media Ops read — never holds the voice. The run is off screen, so every
// stream plays silent (aplay's 'null' device) and Chromium is muted besides.

interface Span {
  readonly stage: string
  readonly durMs: number
}

// The voice is off (#513) and the Page Read this suite spoke through is gone: it waits for the voice to come back,
// when it speaks a long line some other way.
describe.skip('speech through Chromium e2e', () => {
  let harness: Harness
  let dir: string
  let log: string

  const spans = (): Span[] => {
    const logs = join(harness.userDataDir, 'logs')
    if (!existsSync(logs)) return []
    return readdirSync(logs)
      .filter((name) => name.startsWith('perf-') && name.endsWith('.jsonl'))
      .flatMap((name) => readFileSync(join(logs, name), 'utf8').split('\n'))
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Span)
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bingbong-speech-chromium-e2e-'))
    log = join(dir, 'tts.log')
    const voices = join(dir, 'voices')
    await mkdir(voices)
    await writeFile(join(voices, 'en_GB-alba-medium.onnx'), '')
    await writeFile(join(voices, 'en_GB-alba-medium.onnx.json'), JSON.stringify({ audio: { sample_rate: 22050 } }))
    harness = await startHarness({
      launchArgs: ['--browser-cli'],
      pipeStdio: true,
      env: { BINGBONG_PIPER_VOICE_DIR: voices, BINGBONG_FAKE_TTS_LOG: log, BINGBONG_SPEECH_PLAYER: 'chromium' },
    })
    await harness.waitForCliOutput(/bingbong browser harness/)
  })

  afterAll(async () => {
    await harness?.quit()
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  it('reads the page through the hidden speech window: played to its end, no aplay, nothing in the pane', async () => {
    await cli(harness, `navigate ${harness.fixture.url('/story')}`, /^navigated: /)
    await cli(harness, 'read', /^# story fixture — /)
    // The read played out: the first sound and the whole playback were timed.
    const playback = await waitFor(async () => spans().find((span) => span.stage === 'tts-playback'), { timeoutMs: 15_000, intervalMs: 100 })
    expect(spans().some((span) => span.stage === 'tts-first-sound')).toBe(true)
    // Four sentences of 0.1 s from the scripted piper, back to back.
    expect(playback.durMs).toBeGreaterThan(300)
    const lines = readFileSync(log, 'utf8').split('\n')
    expect(lines.filter((line) => line.startsWith('piper-line '))).toHaveLength(4)
    expect(lines.some((line) => line.startsWith('aplay '))).toBe(false)
    // The voice is in a window of its own, never the pane's page.
    const targets = (await harness.cdp.send<{ targetInfos: { type: string; title: string; url: string }[] }>('Target.getTargets')).targetInfos
    expect(targets.some((target) => target.title === 'speech' && target.url.startsWith('data:text/html'))).toBe(true)
    expect(await harness.paneEval<number>("document.querySelectorAll('audio, video').length")).toBe(0)
  })
})
