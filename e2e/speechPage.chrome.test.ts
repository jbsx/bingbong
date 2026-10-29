import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SPEECH_PAGE_SCRIPT } from '../src/main/tts/speechPageScript.ts'
import { canDriveChrome, serveFixtures, type FixtureChrome } from './headlessChrome.ts'

// The speech page (#490) in a real headless Chrome: the page the app's voice
// plays in when BINGBONG_SPEECH_PLAYER=chromium. A stream's sentences play one
// after another with no gap, `done` settles when the last has played, a stop
// settles it at once, and a gain change is one ramp-free step. Every stream
// here is silent (sinkId none), as a run off screen's is, and Chrome runs
// with --mute-audio besides: nothing sounds.

/** `ms` of 22.05 kHz s16 mono, a low tone, base64. */
const tone = (ms: number): string => {
  const frames = Math.round((22050 * ms) / 1000)
  const pcm = Buffer.alloc(frames * 2)
  for (let f = 0; f < frames; f++) pcm.writeInt16LE(Math.round(Math.sin(f / 10) * 8000), f * 2)
  return pcm.toString('base64')
}

describe.skipIf(!canDriveChrome)('the speech page plays a stream and says when it is done (#490)', () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures({ '/speech': `<body><script>${SPEECH_PAGE_SCRIPT}</script></body>` }, 'bingbong-speech-page-chrome-')
    await fixtures.open('/speech')
  }, 60_000)

  afterAll(() => fixtures?.close())

  const run = <T>(script: string): Promise<T> => fixtures.chrome.evaluate<T>(script)

  it("plays a text's sentences back to back and is done when the last has played", async () => {
    const took = await run<{ first: boolean; ms: number; open: number }>(`(async () => {
      const s = window.__speech
      s.open(1, true)
      const first = s.first(1)
      const done = s.done(1)
      const t0 = performance.now()
      s.write(1, 22050, 1, 16, '${tone(300)}')
      s.write(1, 22050, 1, 16, '${tone(300)}')
      s.end(1)
      const started = await first
      await done
      return { first: started, ms: performance.now() - t0, open: s.playing() }
    })()`)
    expect(took.first).toBe(true)
    // Two 300 ms sentences, played one after the other.
    expect(took.ms).toBeGreaterThan(550)
    expect(took.ms).toBeLessThan(1500)
    expect(took.open).toBe(0)
  })

  it('stops mid-sentence at once', async () => {
    const took = await run<{ ms: number; open: number }>(`(async () => {
      const s = window.__speech
      s.open(2, true)
      const done = s.done(2)
      s.write(2, 22050, 1, 16, '${tone(3000)}')
      await new Promise((r) => setTimeout(r, 200))
      const t0 = performance.now()
      s.stop(2)
      await done
      return { ms: performance.now() - t0, open: s.playing() }
    })()`)
    expect(took.ms).toBeLessThan(100)
    expect(took.open).toBe(0)
  })

  it('a stream ended with nothing written is done at once, and says it never started', async () => {
    const took = await run<{ first: boolean }>(`(async () => {
      const s = window.__speech
      s.open(3, true)
      const first = s.first(3)
      const done = s.done(3)
      s.end(3)
      await done
      return { first: await first }
    })()`)
    expect(took.first).toBe(false)
  })

  it('sets the gain of what is left of the line', async () => {
    const gain = await run<number | null>(`(async () => {
      const s = window.__speech
      s.open(4, true)
      const done = s.done(4)
      s.write(4, 22050, 1, 16, '${tone(500)}')
      s.gain(4, 0.15)
      await new Promise((r) => setTimeout(r, 50))
      const level = s.level(4)
      s.stop(4)
      await done
      return level
    })()`)
    expect(gain).toBeCloseTo(0.15, 5)
  })
})
