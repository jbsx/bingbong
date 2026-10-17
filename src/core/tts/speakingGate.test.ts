import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AudioStream, AudioStreamPlayer, SpeakOutcome, SpeechSynthesizer, TtsSpeaker } from '../ports/tts'
import { createSpeakingGate } from './speakingGate'
import { createSpeechCoordinator } from './speechCoordinator'

// The confirmation voice window must not open while the prompt itself is
// still being spoken into the mic. This gate watches the shared TtsSpeaker
// (every speak() the pipeline and download announcements make) and answers
// "is anything being said right now".

// The gate is also the single TTS boundary (#52): markdown the model leaked
// into any spoken line is stripped here, so no consumer can bypass it.

function deferredSpeaker(): {
  speaker: TtsSpeaker
  finish(text: string): void
  spoken: string[]
} {
  const pending = new Map<string, (outcome: SpeakOutcome) => void>()
  const spoken: string[] = []
  return {
    spoken,
    speaker: {
      speak: (text) =>
        new Promise<SpeakOutcome>((resolve) => {
          spoken.push(text)
          pending.set(text, resolve)
        }),
      stop: () => {
        for (const [text, resolve] of pending) {
          resolve({ ok: true })
          pending.delete(text)
        }
      },
    },
    finish: (text) => {
      pending.get(text)?.({ ok: true })
      pending.delete(text)
    },
  }
}

function flush(times = 5): Promise<void> {
  let chain = Promise.resolve()
  for (let i = 0; i < times; i++) chain = chain.then(() => undefined)
  return chain
}

describe('speaking gate', () => {
  it('is idle when nothing was ever spoken', async () => {
    const { speaker } = deferredSpeaker()
    const gate = createSpeakingGate(speaker)

    await expect(gate.waitIdle()).resolves.toBeUndefined()
  })

  it('resolves waitIdle() once the current line finishes', async () => {
    const { speaker, finish } = deferredSpeaker()
    const gate = createSpeakingGate(speaker)

    let idle = false
    void gate.tts.speak('Run click?')
    void gate.waitIdle().then(() => {
      idle = true
    })
    await flush()

    expect(idle).toBe(false)
    finish('Run click?')
    await flush()
    expect(idle).toBe(true)
  })

  it('covers queued lines: idle only after every in-flight line settles', async () => {
    const { speaker, finish } = deferredSpeaker()
    const gate = createSpeakingGate(speaker)

    void gate.tts.speak('first')
    void gate.tts.speak('second')
    let idle = false
    void gate.waitIdle().then(() => {
      idle = true
    })

    finish('first')
    await flush()
    expect(idle).toBe(false)

    finish('second')
    await flush()
    expect(idle).toBe(true)
  })

  it('resolves waitIdle() when speech fails', async () => {
    const failing: TtsSpeaker = {
      speak: () => Promise.resolve({ ok: false, error: 'piper missing' }),
      stop: () => {},
    }
    const gate = createSpeakingGate(failing)

    const speakDone = gate.tts.speak('line')
    await speakDone
    await expect(gate.waitIdle()).resolves.toBeUndefined()
  })

  it('stop() (barge-in) also unblocks waitIdle()', async () => {
    const { speaker } = deferredSpeaker()
    const gate = createSpeakingGate(speaker)

    void gate.tts.speak('long line')
    let idle = false
    void gate.waitIdle().then(() => {
      idle = true
    })

    gate.tts.stop()
    await flush()
    expect(idle).toBe(true)
  })

  it('strips markdown before the line reaches the inner speaker', async () => {
    const { speaker, spoken, finish } = deferredSpeaker()
    const gate = createSpeakingGate(speaker)

    void gate.tts.speak('Opened **YouTube** — see [the video](https://youtu.be/abc).')
    await flush()

    expect(spoken).toEqual(['Opened YouTube — see the video.'])
    finish('Opened YouTube — see the video.')
  })
})

describe('isSpeaking (#326)', () => {
  it('reports a line in flight until it, and every line queued with it, settles', async () => {
    const { speaker, finish } = deferredSpeaker()
    const gate = createSpeakingGate(speaker)
    expect(gate.isSpeaking()).toBe(false)
    const first = gate.tts.speak('one')
    const second = gate.tts.speak('two')
    expect(gate.isSpeaking()).toBe(true)
    finish('one')
    await first
    expect(gate.isSpeaking()).toBe(true)
    finish('two')
    await second
    expect(gate.isSpeaking()).toBe(false)
  })
})

// Barge-in and the mic (#327, AC6): a Page Read spoken sentence by sentence
// is one text in flight from its first sentence to its last, so #326's Hot
// Listen takes no Utterance while piper plays; the wake word and the Abort
// Head reach the playback stream at once.
describe('speaking gate over a streamed text (#327)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /** A synthesizer that renders each sentence after `ms` of the fake clock. */
  function timedSynth(ms: number): SpeechSynthesizer & { texts: string[] } {
    const texts: string[] = []
    return {
      texts,
      synthesize: (text) => {
        texts.push(text)
        return new Promise((resolve) => setTimeout(() => resolve(new Uint8Array([1])), ms))
      },
    }
  }

  /** A stream that plays `ms` per sentence written once it is ended, and is cut at once by stop(). */
  function timedPlayer(ms: number): AudioStreamPlayer & { streams: { stopped: boolean }[] } {
    const streams: { stopped: boolean }[] = []
    return {
      streams,
      open(): AudioStream {
        let written = 0
        let resolveDone!: () => void
        const state = { stopped: false }
        streams.push(state)
        const done = new Promise<void>((resolve) => (resolveDone = resolve))
        return {
          done,
          write: () => {
            written += 1
          },
          end: () => {
            setTimeout(resolveDone, written * ms)
          },
          stop: () => {
            state.stopped = true
            resolveDone()
          },
        }
      },
    }
  }

  it('reports speech in flight from the first sentence to the last', async () => {
    vi.useFakeTimers()
    const synth = timedSynth(100)
    const gate = createSpeakingGate(createSpeechCoordinator({ synth, player: timedPlayer(1_000) }))

    const outcome = gate.tts.speak('One. Two. Three.')
    expect(gate.isSpeaking()).toBe(true)
    await vi.advanceTimersByTimeAsync(150)
    // The first sentence plays, the second renders.
    expect(synth.texts).toEqual(['One.', 'Two.'])
    expect(gate.isSpeaking()).toBe(true)
    await vi.advanceTimersByTimeAsync(200)
    expect(synth.texts).toEqual(['One.', 'Two.', 'Three.'])
    expect(gate.isSpeaking()).toBe(true)
    await vi.advanceTimersByTimeAsync(2_900)
    expect(gate.isSpeaking()).toBe(true)
    await vi.advanceTimersByTimeAsync(100)
    expect(await outcome).toEqual({ ok: true })
    expect(gate.isSpeaking()).toBe(false)
  })

  it('stop() reaches the playback stream at once and the text ends', async () => {
    vi.useFakeTimers()
    const player = timedPlayer(1_000)
    const gate = createSpeakingGate(createSpeechCoordinator({ synth: timedSynth(100), player }))

    const outcome = gate.tts.speak('One. Two. Three.')
    await vi.advanceTimersByTimeAsync(150)
    gate.tts.stop()
    // Synchronously: no tick of the clock passes between the stop and the cut.
    expect(player.streams[0]!.stopped).toBe(true)
    await vi.advanceTimersByTimeAsync(100)
    expect(await outcome).toEqual({ ok: true })
    expect(gate.isSpeaking()).toBe(false)
  })

  it('passes the speak options through to the inner speaker', async () => {
    const seen: unknown[] = []
    const gate = createSpeakingGate({
      speak: async (_text, options) => {
        seen.push(options)
        return { ok: true }
      },
      stop: () => {},
    })
    const onFirstSound = (): void => {}

    await gate.tts.speak('line', { turnId: 't1', onFirstSound })
    expect(seen).toEqual([{ turnId: 't1', onFirstSound }])
  })
})
