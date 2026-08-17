import { describe, expect, it } from 'vitest'
import type { SpeakOutcome, TtsSpeaker } from '../ports/tts'
import { createSpeakingGate } from './speakingGate'

// The confirmation voice window must not open while the prompt itself is
// still being spoken into the mic. This gate watches the shared TtsSpeaker
// (every speak() the pipeline and download announcements make) and answers
// "is anything being said right now".

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
})
