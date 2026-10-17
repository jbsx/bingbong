import { describe, expect, it } from 'vitest'
import { createSpeechCoordinator } from './speechCoordinator'
import type { AudioStream, AudioStreamPlayer, SpeechSynthesizer } from '../ports/tts'
import { createPerfTracer } from '../perf/perfTracer'
import { fakePerfHarness } from '../testing/doubles'

class FakeSynth implements SpeechSynthesizer {
  readonly texts: string[] = []
  private pending: { resolve: (wav: Uint8Array) => void; reject: (err: Error) => void }[] = []

  synthesize(text: string): Promise<Uint8Array> {
    this.texts.push(text)
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject })
    })
  }

  finishNext(wav: Uint8Array = new Uint8Array([1, 2, 3])): void {
    this.pending.shift()?.resolve(wav)
  }

  failNext(error: string): void {
    this.pending.shift()?.reject(new Error(error))
  }

  spawnCount(): number {
    return 1
  }
}

/** A stream double: records what was written, reports its first sample on the first write. */
class FakeStream implements AudioStream {
  readonly writes: Uint8Array[] = []
  ended = false
  stopped = false
  private resolveDone!: () => void
  private rejectDone!: (err: Error) => void
  readonly done = new Promise<void>((resolve, reject) => {
    this.resolveDone = resolve
    this.rejectDone = reject
  })

  constructor(private readonly onFirstSample?: () => void) {}

  write(wav: Uint8Array): void {
    if (this.stopped) return
    this.writes.push(wav)
    if (this.writes.length === 1) this.onFirstSample?.()
  }

  end(): void {
    this.ended = true
  }

  /** The last sentence written has played. */
  finish(): void {
    this.resolveDone()
  }

  fail(error: string): void {
    this.rejectDone(new Error(error))
  }

  stop(): void {
    this.stopped = true
    this.resolveDone()
  }
}

class FakePlayer implements AudioStreamPlayer {
  readonly streams: FakeStream[] = []

  open(options?: { onFirstSample?: () => void }): AudioStream {
    const stream = new FakeStream(options?.onFirstSample)
    this.streams.push(stream)
    return stream
  }
}

function recordingDucker(events: string[]) {
  return {
    duck: () => events.push('duck'),
    restore: () => events.push('restore'),
  }
}

/** Flush the microtask queue so deferred synth/playback continuations have run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

describe('speech coordinator', () => {
  it('ducks page audio, speaks, then restores in order', async () => {
    const events: string[] = []
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player, ducker: recordingDucker(events) })

    const outcome = tts.speak('hello')
    await flush()
    expect(events).toEqual(['duck'])
    expect(synth.texts).toEqual(['hello'])

    synth.finishNext()
    await flush()
    expect(player.streams).toHaveLength(1)
    expect(player.streams[0]!.ended).toBe(true)

    player.streams[0]!.finish()
    expect(await outcome).toEqual({ ok: true })
    expect(events).toEqual(['duck', 'restore'])
  })

  it('hands the first sentence to playback before the second has been synthesized, through one stream (AC2)', async () => {
    const events: string[] = []
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player, ducker: recordingDucker(events) })
    const first = new Uint8Array([1])
    const second = new Uint8Array([2])
    const third = new Uint8Array([3])

    const outcome = tts.speak('One here. Two here. Three here.')
    await flush()
    expect(synth.texts).toEqual(['One here.'])

    synth.finishNext(first)
    await flush()
    // The first sentence plays while the second is still being synthesized.
    expect(player.streams).toHaveLength(1)
    expect(player.streams[0]!.writes).toEqual([first])
    expect(synth.texts).toEqual(['One here.', 'Two here.'])

    synth.finishNext(second)
    await flush()
    synth.finishNext(third)
    await flush()
    expect(player.streams).toHaveLength(1)
    expect(player.streams[0]!.writes).toEqual([first, second, third])
    expect(player.streams[0]!.ended).toBe(true)

    player.streams[0]!.finish()
    expect(await outcome).toEqual({ ok: true })
    // Page audio ducks once for the whole text, not per sentence.
    expect(events).toEqual(['duck', 'restore'])
  })

  it('stop() during the second sentence ends playback and discards the third (AC2)', async () => {
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player })

    const outcome = tts.speak('One here. Two here. Three here.')
    synth.finishNext()
    await flush()
    synth.finishNext()
    await flush()
    // The second sentence is playing; the third is being synthesized.
    expect(synth.texts).toEqual(['One here.', 'Two here.', 'Three here.'])

    tts.stop()
    expect(player.streams[0]!.stopped).toBe(true)
    synth.finishNext()
    expect(await outcome).toEqual({ ok: true, stopped: true })
    expect(player.streams[0]!.writes).toHaveLength(2)
  })

  it('never synthesizes the sentences after the one in flight when stopped (AC3)', async () => {
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player })

    const outcome = tts.speak('One. Two. Three. Four.')
    synth.finishNext()
    await flush()
    expect(synth.texts).toEqual(['One.', 'Two.'])

    tts.stop()
    synth.finishNext()
    expect(await outcome).toEqual({ ok: true, stopped: true })
    await flush()
    expect(synth.texts).toEqual(['One.', 'Two.'])
  })

  it('calls onFirstSound once, when the first sample is handed to the player', async () => {
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player })
    let sounds = 0

    const outcome = tts.speak('One. Two.', { onFirstSound: () => (sounds += 1) })
    await flush()
    expect(sounds).toBe(0)
    synth.finishNext()
    await flush()
    expect(sounds).toBe(1)
    synth.finishNext()
    await flush()
    player.streams[0]!.finish()
    await outcome
    expect(sounds).toBe(1)
  })

  it('serializes concurrent speaks so texts never overlap', async () => {
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player })

    const first = tts.speak('one')
    const second = tts.speak('two')
    await flush()
    expect(synth.texts).toEqual(['one'])

    synth.finishNext()
    await flush()
    player.streams[0]!.finish()
    await first
    await flush()
    expect(synth.texts).toEqual(['one', 'two'])

    synth.finishNext()
    await flush()
    player.streams[1]!.finish()
    expect(await second).toEqual({ ok: true })
  })

  it('stop() kills playback instantly and resolves the in-flight speak', async () => {
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player })

    const outcome = tts.speak('hello')
    synth.finishNext()
    await flush()
    const stream = player.streams[0]!

    tts.stop()
    expect(stream.stopped).toBe(true)
    expect(await outcome).toEqual({ ok: true, stopped: true })
  })

  it('stop() drops queued texts before they reach the synthesizer', async () => {
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player })

    const first = tts.speak('one')
    const second = tts.speak('two')
    synth.finishNext()
    await flush()

    tts.stop()
    await first
    expect(await second).toEqual({ ok: true, stopped: true })
    await flush()
    expect(synth.texts).toEqual(['one'])
  })

  it('stop() during synthesis of the first sentence never opens playback', async () => {
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player })

    const outcome = tts.speak('hello')
    tts.stop()
    synth.finishNext()
    expect(await outcome).toEqual({ ok: true, stopped: true })
    await flush()
    expect(player.streams).toHaveLength(0)
  })

  it('restores page audio and reports the error when synthesis fails', async () => {
    const events: string[] = []
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player, ducker: recordingDucker(events) })

    const outcome = tts.speak('hello')
    synth.failNext('piper binary not found')

    expect(await outcome).toEqual({ ok: false, error: 'piper binary not found' })
    expect(events).toEqual(['duck', 'restore'])
    expect(player.streams).toHaveLength(0)
  })

  it('plays what was synthesized and reports the error when a later sentence fails', async () => {
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player })

    const outcome = tts.speak('One. Two.')
    synth.finishNext()
    await flush()
    synth.failNext('piper died')
    await flush()
    expect(player.streams[0]!.ended).toBe(true)
    expect(player.streams[0]!.stopped).toBe(false)

    player.streams[0]!.finish()
    expect(await outcome).toEqual({ ok: false, error: 'piper died' })
  })

  it('restores page audio and reports the error when playback fails', async () => {
    const events: string[] = []
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player, ducker: recordingDucker(events) })

    const outcome = tts.speak('hello')
    synth.finishNext()
    await flush()
    player.streams[0]!.fail('aplay died')

    expect(await outcome).toEqual({ ok: false, error: 'aplay died' })
    expect(events).toEqual(['duck', 'restore'])
  })

  it('keeps page audio ducked when a new speak starts as a stopped one unwinds', async () => {
    const events: string[] = []
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player, ducker: recordingDucker(events) })

    const first = tts.speak('one')
    synth.finishNext()
    await flush()
    tts.stop()
    await first

    const second = tts.speak('two')
    synth.finishNext()
    await flush()
    // One duck for each speak; the first restore must not un-duck the second.
    expect(events.filter((e) => e === 'restore')).toHaveLength(1)

    player.streams[1]!.finish()
    await second
    expect(events).toEqual(['duck', 'restore', 'duck', 'restore'])
  })

  it('a blank text speaks nothing and resolves ok', async () => {
    const events: string[] = []
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player, ducker: recordingDucker(events) })

    expect(await tts.speak('   ')).toEqual({ ok: true })
    expect(synth.texts).toEqual([])
    expect(events).toEqual([])
  })

  it('stop() with nothing playing is a safe no-op', () => {
    const tts = createSpeechCoordinator({ synth: new FakeSynth(), player: new FakePlayer() })
    expect(() => tts.stop()).not.toThrow()
  })
})

// The TTS half of the perf log (#31, #327): a spoken text keyed to a turn
// records one `tts-synthesis` span per sentence with its index, one
// `tts-first-sound` span from the speak call to the first sample handed to
// the player, and one `tts-playback` span from the stream's opening to its end.
describe('speech coordinator — perf spans (#31, #327)', () => {
  const AT = 1_700_000_000_000

  it('records synthesis per sentence with its index, first sound once and playback once (AC5)', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player, tracer })

    state.monotonicMs = 10
    const outcome = tts.speak('One. Two.', { turnId: 'turn-1' })
    await flush()
    state.monotonicMs = 130
    synth.finishNext()
    await flush()
    state.monotonicMs = 180
    synth.finishNext()
    await flush()
    state.monotonicMs = 900
    player.streams[0]!.finish()
    expect(await outcome).toEqual({ ok: true })

    expect(records).toEqual([
      { turnId: 'turn-1', stage: 'tts-synthesis', durMs: 120, at: AT, t: 130, detail: { index: 0, spawns: 1 } },
      { turnId: 'turn-1', stage: 'tts-first-sound', durMs: 120, at: AT, t: 130 },
      { turnId: 'turn-1', stage: 'tts-synthesis', durMs: 50, at: AT, t: 180, detail: { index: 1, spawns: 1 } },
      { turnId: 'turn-1', stage: 'tts-playback', durMs: 770, at: AT, t: 900 },
    ])
  })

  it('measures first sound from the speak call, queue wait included', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player, tracer })

    const first = tts.speak('one')
    state.monotonicMs = 100
    const second = tts.speak('two', { turnId: 'turn-2' })
    synth.finishNext()
    await flush()
    state.monotonicMs = 400
    player.streams[0]!.finish()
    await first
    await flush()
    state.monotonicMs = 450
    synth.finishNext()
    await flush()
    player.streams[1]!.finish()
    await second

    expect(records.find((r) => r.stage === 'tts-first-sound')).toMatchObject({ turnId: 'turn-2', durMs: 350 })
  })

  it('records the synthesis span but no first sound or playback when stop() lands during synthesis', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player, tracer })

    const outcome = tts.speak('hello', { turnId: 'turn-1' })
    tts.stop()
    state.monotonicMs = 90
    synth.finishNext()
    expect(await outcome).toEqual({ ok: true, stopped: true })

    expect(records).toEqual([{ turnId: 'turn-1', stage: 'tts-synthesis', durMs: 90, at: AT, t: 90, detail: { index: 0, spawns: 1 } }])
  })

  it('records the playback span up to the stop when barge-in lands mid-playback', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player, tracer })

    const outcome = tts.speak('hello', { turnId: 'turn-1' })
    state.monotonicMs = 200
    synth.finishNext()
    await flush()
    state.monotonicMs = 350
    tts.stop()
    expect(await outcome).toEqual({ ok: true, stopped: true })

    expect(records.map((r) => [r.stage, r.durMs])).toEqual([
      ['tts-synthesis', 200],
      ['tts-first-sound', 200],
      ['tts-playback', 150],
    ])
  })

  it('records the synthesis span when synthesis fails — the render time was spent', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player, tracer })

    const outcome = tts.speak('hello', { turnId: 'turn-1' })
    state.monotonicMs = 150
    synth.failNext('piper died')

    expect(await outcome).toEqual({ ok: false, error: 'piper died' })
    expect(records).toEqual([{ turnId: 'turn-1', stage: 'tts-synthesis', durMs: 150, at: AT, t: 150, detail: { index: 0, spawns: 1 } }])
  })

  it('logs nothing for texts without a turn id — download announcements', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player, tracer })

    const outcome = tts.speak('download finished')
    state.monotonicMs = 40
    synth.finishNext()
    await flush()
    player.streams[0]!.finish()
    expect(await outcome).toEqual({ ok: true })

    expect(records).toEqual([])
  })

  it('never breaks speech over bookkeeping — a throwing sink still resolves ok', async () => {
    const state = { monotonicMs: 0 }
    const tracer = createPerfTracer({
      sink: {
        write() {
          throw new Error('disk full')
        },
      },
      clock: { monotonic: () => state.monotonicMs, wall: () => 0 },
    })
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player, tracer })
    let sounds = 0

    const outcome = tts.speak('hello', { turnId: 'turn-1', onFirstSound: () => (sounds += 1) })
    synth.finishNext()
    await flush()
    player.streams[0]!.finish()

    expect(await outcome).toEqual({ ok: true })
    expect(sounds).toBe(1)
  })
})
