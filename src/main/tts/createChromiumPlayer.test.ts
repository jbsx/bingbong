import { describe, expect, it } from 'vitest'
import { createChromiumPlayer as createPlayer, type ChromiumPlayerDeps, type PcmFormat, type SpeechSurface } from './createChromiumPlayer'
import { createSpeechCoordinator } from '../../core/tts/speechCoordinator'
import { wrapRawPcmAsWav } from '../../core/tts/wav'

/** A page that does what it is told when the test says: each stream's first sample and its end are the test's to settle. */
function fakeSurface() {
  const calls: string[] = []
  const streams = new Map<number, { silent: boolean; first: (started: boolean) => void; done: () => void; fail: (error: Error) => void; written: Uint8Array[] }>()
  const surface: SpeechSurface = {
    open(id, silent) {
      calls.push(`open ${id} ${silent ? 'silent' : 'out'}`)
      let first!: (started: boolean) => void
      let done!: () => void
      let fail!: (error: Error) => void
      const page = {
        first: new Promise<boolean>((resolve) => (first = resolve)),
        done: new Promise<void>((resolve, reject) => {
          done = resolve
          fail = reject
        }),
      }
      streams.set(id, { silent, first, done, fail, written: [] })
      return page
    },
    write(id, format: PcmFormat, pcm) {
      calls.push(`write ${id} ${format.sampleRate}/${format.channels}/${format.bitsPerSample} ${pcm.length}`)
      streams.get(id)!.written.push(pcm)
    },
    end(id) {
      calls.push(`end ${id}`)
    },
    gain(id, value) {
      calls.push(`gain ${id} ${value}`)
    },
    stop(id) {
      calls.push(`stop ${id}`)
      streams.get(id)!.done()
    },
  }
  return { surface, calls, streams }
}

/** The player with no watchdog timer unless the test sets one: a stream a test leaves open fails nowhere. */
const createChromiumPlayer = (deps: ChromiumPlayerDeps) => createPlayer({ setTimeoutFn: () => null, clearTimeoutFn: () => {}, ...deps })

const sentence = (bytes: number, rate = 22050): Uint8Array => wrapRawPcmAsWav(new Uint8Array(bytes).fill(7), rate)
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('the Chromium speech player (#490)', () => {
  it("streams a text's sentences into one page stream, in order, and is done when the page has played them", async () => {
    const { surface, calls, streams } = fakeSurface()
    const player = createChromiumPlayer({ surface })
    const stream = player.open()
    stream.write(sentence(400))
    stream.write(sentence(200))
    stream.end()

    expect(calls).toEqual(['open 1 out', 'write 1 22050/1/16 400', 'write 1 22050/1/16 200', 'end 1'])
    let settled = false
    void stream.done.then(() => (settled = true))
    await flush()
    expect(settled).toBe(false)
    streams.get(1)!.done()
    await expect(stream.done).resolves.toBeUndefined()
  })

  it('says its first sample once the page has it scheduled, not when it is written', async () => {
    const { surface, streams } = fakeSurface()
    let firsts = 0
    const stream = createChromiumPlayer({ surface }).open({ onFirstSample: () => (firsts += 1) })
    stream.write(sentence(400))
    await flush()
    expect(firsts).toBe(0)
    streams.get(1)!.first(true)
    await flush()
    expect(firsts).toBe(1)
  })

  it('cuts a line mid-sentence: the page is told to stop, done resolves at once, and nothing more is written', async () => {
    const { surface, calls, streams } = fakeSurface()
    let firsts = 0
    const stream = createChromiumPlayer({ surface }).open({ onFirstSample: () => (firsts += 1) })
    stream.write(sentence(400))
    stream.stop()
    await expect(stream.done).resolves.toBeUndefined()
    stream.write(sentence(400))
    stream.end()
    // A first sample the page reports after the cut is not a sound.
    streams.get(1)!.first(true)
    await flush()
    expect(firsts).toBe(0)
    expect(calls).toEqual(['open 1 out', 'write 1 22050/1/16 400', 'stop 1'])
  })

  it('plays to no device while the Sound Mute holds, read at each stream as aplay reads it at each aplay', () => {
    const { surface, calls } = fakeSurface()
    let muted = true
    const player = createChromiumPlayer({ surface, muted: () => muted })
    player.open()
    muted = false
    player.open()
    expect(calls).toEqual(['open 1 silent', 'open 2 out'])
  })

  it("plays every stream silent on aplay's 'null' device, the run off screen", () => {
    const { surface, calls } = fakeSurface()
    const player = createChromiumPlayer({ surface, device: 'null', muted: () => false })
    player.open()
    player.play(sentence(100))
    expect(calls.filter((call) => call.startsWith('open'))).toEqual(['open 1 silent', 'open 2 silent'])
  })

  it('ducks the line with one gain change on its stream', () => {
    const { surface, calls } = fakeSurface()
    const stream = createChromiumPlayer({ surface }).open()
    stream.setGain!(0.15)
    stream.setGain!(1)
    expect(calls.slice(1)).toEqual(['gain 1 0.15', 'gain 1 1'])
  })

  it('plays one WAV (the chime) as a stream of one', async () => {
    const { surface, calls, streams } = fakeSurface()
    const playback = createChromiumPlayer({ surface }).play(sentence(100, 44100))
    expect(calls).toEqual(['open 1 out', 'write 1 44100/1/16 100', 'end 1'])
    streams.get(1)!.done()
    await expect(playback.done).resolves.toBeUndefined()
  })

  it('numbers each stream on the one page', () => {
    const { surface, calls } = fakeSurface()
    const player = createChromiumPlayer({ surface })
    player.play(sentence(10))
    player.open()
    expect(calls.filter((call) => call.startsWith('open'))).toEqual(['open 1 out', 'open 2 out'])
  })

  it('skips bytes that are not a WAV, and an empty sentence', () => {
    const { surface, calls } = fakeSurface()
    const stream = createChromiumPlayer({ surface }).open()
    stream.write(new Uint8Array([1, 2, 3]))
    stream.write(sentence(0))
    expect(calls).toEqual(['open 1 out'])
  })

  it('fails a line whose page fails, as an aplay that dies fails it', async () => {
    const { surface, streams } = fakeSurface()
    const stream = createChromiumPlayer({ surface }).open()
    stream.write(sentence(400))
    stream.end()
    streams.get(1)!.fail(new Error('Render frame was disposed'))
    await expect(stream.done).rejects.toThrow(/speech page failed: Render frame was disposed/)
  })

  it('fails a line the page never finishes, once its sound and the grace have passed: no line speaks forever', async () => {
    const { surface } = fakeSurface()
    const timers: { fn: () => void; ms: number }[] = []
    const stream = createChromiumPlayer({ surface, graceMs: 5000, setTimeoutFn: (fn, ms) => timers.push({ fn, ms }), clearTimeoutFn: () => {} }).open()
    // One second of 22.05 kHz s16 mono.
    stream.write(sentence(44100))
    stream.end()
    expect(timers.map((timer) => timer.ms)).toEqual([6000])
    timers[0]!.fn()
    await expect(stream.done).rejects.toThrow(/never finished/)
  })

  it('carries a spoken text through the speech coordinator: first sound, then done once the page has played it', async () => {
    const { surface, streams } = fakeSurface()
    const synth = { synthesize: async () => sentence(400) }
    const tts = createSpeechCoordinator({ synth, player: createChromiumPlayer({ surface }) })
    let firstSound = false
    const outcome = tts.speak('The lamp was cold. He lit it.', { onFirstSound: () => (firstSound = true) })
    await new Promise((resolve) => setTimeout(resolve, 10))
    streams.get(1)!.first(true)
    await flush()
    expect(firstSound).toBe(true)
    expect(streams.get(1)!.written).toHaveLength(2)
    streams.get(1)!.done()
    await expect(outcome).resolves.toEqual({ ok: true })
  })
})
