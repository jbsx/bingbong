import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { cli } from './cliSupport'
import { waitFor } from './waitFor'

// Increment 3 (#327): a line is spoken sentence by sentence
// through one piper that stays up, into one player stream per spoken text;
// and a failed action speaks its one line. The synthesizer and the player
// are the scripted bins in e2e/bin (the hermetic env sets them); they log
// what they were given, which is what this suite reads.

describe('speech e2e', () => {
  let harness: Harness
  let dir: string
  let log: string

  const logLines = async (): Promise<string[]> => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter((line) => line !== '')

  /** Waits until the log holds a line matching each pattern, and returns the log. */
  async function heard(...patterns: RegExp[]): Promise<string[]> {
    return waitFor(
      async () => {
        const lines = await logLines()
        return patterns.every((pattern) => lines.some((line) => pattern.test(line))) ? lines : undefined
      },
      { timeoutMs: 10_000, intervalMs: 100 },
    )
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bingbong-tts-e2e-'))
    log = join(dir, 'tts.log')
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

  it('speaks a line sentence by sentence, through one piper prefetched at startup and one player stream per line', async () => {
    // Prefetched: the process is up before anything is spoken.
    await heard(/^piper-start persistent$/)
    await cli(harness, `navigate ${harness.fixture.url('/landing/missing')}`, /^navigated: /)
    const lines = await heard(/^piper-line Try “back”\.$/, /^aplay .*-t raw/)

    const spoken = lines.filter((line) => line.startsWith('piper-line ')).map((line) => line.slice('piper-line '.length))
    expect(spoken).toEqual(["That page doesn't exist.", 'Try “back”.'])
    const plays = lines.filter((line) => line.startsWith('aplay '))
    expect(plays).toHaveLength(1)
    // Two sentences of 0.1 s each, through the one stream.
    expect(plays[0]).toBe('aplay -D null -q -t raw -f S16_LE -c 1 -r 22050 - bytes=8820')

    await cli(harness, `navigate ${harness.fixture.url('/landing/missing')}`, /^navigated: /)
    const again = await waitFor(async () => {
      const current = await logLines()
      // By its sentences, not by its stream: a line asked while the last one's stream is still open may join it.
      return current.filter((line) => line.startsWith('piper-line ')).length === 4 ? current : undefined
    }, { timeoutMs: 10_000, intervalMs: 100 })
    // The same process served the second line: no new piper.
    expect(again.filter((line) => line.startsWith('piper-start'))).toEqual(['piper-start persistent'])
  })

  it('speaks a failed action\'s one line and never its error', async () => {
    await cli(harness, 'click 999', /^error: /)
    // In the person's words, never the action's error ("ref 999 …").
    const lines = await heard(/^piper-line That number isn't one I can use here\./)
    expect(lines.some((line) => /\bref\b/.test(line) && line.startsWith('piper-line'))).toBe(false)
  })
})
