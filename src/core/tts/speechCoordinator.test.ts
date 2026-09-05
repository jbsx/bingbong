import { describe, expect, it } from 'vitest'
import { createSpeechCoordinator } from './speechCoordinator'
import type { AudioPlayback, AudioPlayer, SpeechSynthesizer } from '../ports/tts'
import { createPerfTracer } from '../perf/perfTracer'
import { fakePerfHarness } from '../testing/doubles'
import type { HostTraceEvent } from '../trace/hostTrace'

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

  get inFlight(): number {
    return this.pending.length
  }
}

class FakePlayback implements AudioPlayback {
  stopped = false
  private resolveDone!: () => void
  private rejectDone!: (err: Error) => void
  readonly done = new Promise<void>((resolve, reject) => {
    this.resolveDone = resolve
    this.rejectDone = reject
  })

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

class FakePlayer implements AudioPlayer {
  readonly playbacks: FakePlayback[] = []

  play(): AudioPlayback {
    const playback = new FakePlayback()
    this.playbacks.push(playback)
    return playback
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
    expect(player.playbacks).toHaveLength(1)

    player.playbacks[0]!.finish()
    expect(await outcome).toEqual({ ok: true })
    expect(events).toEqual(['duck', 'restore'])
  })

  it('serializes concurrent speaks so lines never overlap', async () => {
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player })

    const first = tts.speak('one')
    const second = tts.speak('two')
    await flush()
    expect(synth.texts).toEqual(['one'])

    synth.finishNext()
    await flush()
    player.playbacks[0]!.finish()
    await first
    await flush()
    expect(synth.texts).toEqual(['one', 'two'])

    synth.finishNext()
    await flush()
    player.playbacks[1]!.finish()
    expect(await second).toEqual({ ok: true })
  })

  it('stop() kills playback instantly and resolves the in-flight speak', async () => {
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player })

    const outcome = tts.speak('hello')
    synth.finishNext()
    await flush()
    const playback = player.playbacks[0]!

    tts.stop()
    expect(playback.stopped).toBe(true)
    expect(await outcome).toEqual({ ok: true })
  })

  it('stop() drops queued lines before they reach the synthesizer', async () => {
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player })

    const first = tts.speak('one')
    const second = tts.speak('two')
    synth.finishNext()
    await flush()

    tts.stop()
    await first
    expect(await second).toEqual({ ok: true })
    await flush()
    expect(synth.texts).toEqual(['one'])
  })

  it('stop() during synthesis never plays the audio', async () => {
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player })

    const outcome = tts.speak('hello')
    tts.stop()
    synth.finishNext()
    expect(await outcome).toEqual({ ok: true })
    await flush()
    expect(player.playbacks).toHaveLength(0)
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
    expect(player.playbacks).toHaveLength(0)
  })

  it('restores page audio and reports the error when playback fails', async () => {
    const events: string[] = []
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player, ducker: recordingDucker(events) })

    const outcome = tts.speak('hello')
    synth.finishNext()
    await flush()
    player.playbacks[0]!.fail('aplay died')

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

    player.playbacks[1]!.finish()
    await second
    expect(events).toEqual(['duck', 'restore', 'duck', 'restore'])
  })

  it('stop() with nothing playing is a safe no-op', () => {
    const tts = createSpeechCoordinator({ synth: new FakeSynth(), player: new FakePlayer() })
    expect(() => tts.stop()).not.toThrow()
  })
})

// The TTS half of the perf log (#31): every spoken line of a turn records
// two spans at this seam — one for synthesis (piper rendering), one for
// playback (aplay speaking) — so the full-clip design's cost is visible as
// "time to first audio" vs "time speaking". Keyed by the turn id the caller
// rides on speak(); the coordinator's queue guarantees the pair order.
describe('speech coordinator — synthesis/playback span split (#31)', () => {
  it('records a synthesis span then a playback span per spoken line, keyed by the turn id, in queue order', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player, tracer })

    const first = tts.speak('one', 'turn-voice-1')
    const second = tts.speak('two', 'turn-voice-1')
    await flush()
    state.monotonicMs = 120
    synth.finishNext()
    await flush()
    state.monotonicMs = 500
    player.playbacks[0]!.finish()
    await first
    await flush()
    state.monotonicMs = 620
    synth.finishNext()
    await flush()
    state.monotonicMs = 1_100
    player.playbacks[1]!.finish()
    expect(await second).toEqual({ ok: true })

    expect(records).toEqual([
      { turnId: 'turn-voice-1', stage: 'tts-synthesis', durMs: 120, at: 1_700_000_000_000, t: 120 },
      { turnId: 'turn-voice-1', stage: 'tts-playback', durMs: 380, at: 1_700_000_000_000, t: 500 },
      { turnId: 'turn-voice-1', stage: 'tts-synthesis', durMs: 120, at: 1_700_000_000_000, t: 620 },
      { turnId: 'turn-voice-1', stage: 'tts-playback', durMs: 480, at: 1_700_000_000_000, t: 1_100 },
    ])
  })

  it('records the synthesis span but no playback span when stop() lands during synthesis', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player, tracer })

    const outcome = tts.speak('hello', 'turn-voice-1')
    tts.stop()
    state.monotonicMs = 90
    synth.finishNext()
    expect(await outcome).toEqual({ ok: true })

    expect(records).toEqual([
      { turnId: 'turn-voice-1', stage: 'tts-synthesis', durMs: 90, at: 1_700_000_000_000, t: 90 },
    ])
  })

  it('records the playback span up to the stop when barge-in lands mid-playback', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player, tracer })

    const outcome = tts.speak('hello', 'turn-voice-1')
    state.monotonicMs = 200
    synth.finishNext()
    await flush()
    state.monotonicMs = 350
    tts.stop()
    expect(await outcome).toEqual({ ok: true })

    expect(records).toEqual([
      { turnId: 'turn-voice-1', stage: 'tts-synthesis', durMs: 200, at: 1_700_000_000_000, t: 200 },
      { turnId: 'turn-voice-1', stage: 'tts-playback', durMs: 150, at: 1_700_000_000_000, t: 350 },
    ])
  })

  it('records the synthesis span when synthesis fails — the render time was spent', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player, tracer })

    const outcome = tts.speak('hello', 'turn-voice-1')
    state.monotonicMs = 150
    synth.failNext('piper died')

    expect(await outcome).toEqual({ ok: false, error: 'piper died' })
    expect(records).toEqual([
      { turnId: 'turn-voice-1', stage: 'tts-synthesis', durMs: 150, at: 1_700_000_000_000, t: 150 },
    ])
  })

  it('logs nothing for lines without a turn id — download and subagent speech', async () => {
    const { records, state, tracer } = fakePerfHarness()
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player, tracer })

    const outcome = tts.speak('download finished')
    state.monotonicMs = 40
    synth.finishNext()
    await flush()
    player.playbacks[0]!.finish()
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

    const outcome = tts.speak('hello', 'turn-voice-1')
    synth.finishNext()
    await flush()
    player.playbacks[0]!.finish()

    expect(await outcome).toEqual({ ok: true })
  })
})

// The spoken-line records (#186, ADR 0031): the exact text piper was
// given, and every line barge-in dropped — with where the stop reached it.
describe('spoken-line records', () => {
  function tracingCoordinator() {
    const traced: HostTraceEvent[] = []
    const synth = new FakeSynth()
    const player = new FakePlayer()
    const tts = createSpeechCoordinator({ synth, player, hostTrace: (event) => traced.push(event()) })
    return { traced, synth, player, tts }
  }

  it('records the exact text handed to the synthesizer, with the turn when it had one', async () => {
    const { traced, synth, player, tts } = tracingCoordinator()
    const outcome = tts.speak('Here is what I found.', 'turn-3')
    await flush()
    expect(traced).toEqual([{ kind: 'tts_line', text: 'Here is what I found.', chars: 21, turnId: 'turn-3' }])
    synth.finishNext()
    await flush()
    player.playbacks[0]!.finish()
    await outcome
  })

  it('records a line with no turn — a download announcement — without inventing one', async () => {
    const { traced, tts } = tracingCoordinator()
    void tts.speak('Download finished.')
    await flush()
    expect(traced[0]).not.toHaveProperty('turnId')
  })

  it('records a queued line the barge-in dropped before it was ever synthesized', async () => {
    const { traced, tts } = tracingCoordinator()
    void tts.speak('first')
    void tts.speak('second', 'turn-3')
    await flush()
    tts.stop()
    expect(traced.filter((event) => event.kind === 'tts_dropped')).toEqual([
      { kind: 'tts_dropped', text: 'second', chars: 6, stage: 'queued', turnId: 'turn-3' },
    ])
  })

  it('records a line stopped while piper was still rendering it', async () => {
    const { traced, synth, tts } = tracingCoordinator()
    const outcome = tts.speak('first')
    await flush()
    tts.stop()
    synth.finishNext()
    await outcome
    expect(traced.filter((event) => event.kind === 'tts_dropped')).toEqual([
      { kind: 'tts_dropped', text: 'first', chars: 5, stage: 'synthesized' },
    ])
  })

  it('records the line a barge-in cut off mid-playback', async () => {
    const { traced, synth, player, tts } = tracingCoordinator()
    const outcome = tts.speak('a long answer', 'turn-3')
    await flush()
    synth.finishNext()
    await flush()
    expect(player.playbacks).toHaveLength(1)
    tts.stop()
    await outcome
    expect(traced.filter((event) => event.kind === 'tts_dropped')).toEqual([
      { kind: 'tts_dropped', text: 'a long answer', chars: 13, stage: 'speaking', turnId: 'turn-3' },
    ])
  })

  it('records nothing but the ask when a line finishes normally', async () => {
    const { traced, synth, player, tts } = tracingCoordinator()
    const outcome = tts.speak('done')
    await flush()
    synth.finishNext()
    await flush()
    player.playbacks[0]!.finish()
    await outcome
    expect(traced.map((event) => event.kind)).toEqual(['tts_line'])
  })
})
