import { describe, expect, it } from 'vitest'
import { createSpeechCoordinator } from './speechCoordinator'
import type { AudioPlayback, AudioPlayer, SpeechSynthesizer } from '../ports/tts'

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
