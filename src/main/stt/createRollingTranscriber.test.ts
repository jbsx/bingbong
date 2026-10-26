import { describe, expect, it } from 'vitest'
import { createRollingTranscriber } from './createRollingTranscriber'

// The rolling partials every batch-pass engine shares (#41, #358): the
// first pass waits for half a second of speech by default (#441). Since #443
// the final can be decoded at the pause: there each decode is held until the
// test releases it, so the order passes run in and which audio each decodes
// is what the tests read. Audio is identified by its length.

const FRAME = 512

interface Pass {
  samples: number
  release(text: string): void
}

function fakeEngine(partialMinSamples = FRAME * 2) {
  const passes: Pass[] = []
  const transcriber = createRollingTranscriber({
    engine: 'fake',
    partialFaultSite: 'test.partial',
    partialMinSamples,
    partialStrideSamples: FRAME * 2,
    decodePass: (pcm) =>
      new Promise<string>((resolve) => {
        passes.push({ samples: pcm.length, release: resolve })
      }),
  })
  return { transcriber, passes }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('createRollingTranscriber', () => {
  it('runs its first partial pass at half a second of speech, not before (#441)', async () => {
    const passes: number[] = []
    const transcriber = createRollingTranscriber({
      engine: 'test',
      partialFaultSite: 'test.partial',
      decodePass: async (pcm) => {
        passes.push(pcm.length)
        return 'pause'
      },
    })
    const partials: string[] = []
    transcriber.onPartial((text) => partials.push(text))
    transcriber.begin()
    // 15 frames = 7,680 samples: just under 0.5 s at 16 kHz.
    for (let i = 0; i < 15; i++) transcriber.push(new Float32Array(FRAME))
    await flush()
    expect(passes).toEqual([])
    transcriber.push(new Float32Array(FRAME))
    await flush()
    expect(passes).toEqual([16 * FRAME])
    expect(partials).toEqual(['pause'])
  })
})

const audio = (frames: number): Float32Array => new Float32Array(frames * FRAME)
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('the final decoded at the pause (#443)', () => {
  it('starts the decode when the pause is reached, and finish() over the same audio resolves its words with no second pass', async () => {
    const { transcriber, passes } = fakeEngine(FRAME * 100)
    transcriber.begin()
    for (let i = 0; i < 10; i += 1) transcriber.push(audio(1))

    transcriber.pauseReached?.(audio(8))
    await settle()
    expect(passes.map((pass) => pass.samples)).toEqual([8 * FRAME])

    const final = transcriber.finish(audio(8))
    passes[0]!.release('scroll down')

    expect(await final).toBe('scroll down')
    expect(passes).toHaveLength(1)
  })

  it('decodes the Endpoint afresh when its audio is not the pause audio', async () => {
    const { transcriber, passes } = fakeEngine(FRAME * 100)
    transcriber.begin()
    transcriber.pauseReached?.(audio(8))
    await settle()
    passes[0]!.release('scroll')

    const final = transcriber.finish(audio(40))
    await settle()
    expect(passes.map((pass) => pass.samples)).toEqual([8 * FRAME, 40 * FRAME])
    passes[1]!.release('scroll down please')

    expect(await final).toBe('scroll down please')
  })

  it('drops the pause decode when speech comes back, even over audio of the same length', async () => {
    const { transcriber, passes } = fakeEngine(FRAME * 100)
    transcriber.begin()
    transcriber.pauseReached?.(audio(8))
    await settle()
    passes[0]!.release('scroll')
    transcriber.pauseEnded?.()

    const final = transcriber.finish(audio(8))
    await settle()
    expect(passes).toHaveLength(2)
    passes[1]!.release('scroll down')

    expect(await final).toBe('scroll down')
  })

  it("a later capture never reads an earlier capture's pause decode", async () => {
    const { transcriber, passes } = fakeEngine(FRAME * 100)
    transcriber.begin()
    transcriber.pauseReached?.(audio(8))
    await settle()
    passes[0]!.release('go back')
    transcriber.cancel()

    transcriber.begin()
    const final = transcriber.finish(audio(8))
    await settle()
    expect(passes).toHaveLength(2)
    passes[1]!.release('reload')

    expect(await final).toBe('reload')
  })

  it('starts no partial after the pause, and partials roll again once speech comes back', async () => {
    const { transcriber, passes } = fakeEngine()
    transcriber.begin()
    transcriber.pauseReached?.(audio(1))
    await settle()
    passes[0]!.release('')
    await settle()

    for (let i = 0; i < 6; i += 1) transcriber.push(audio(1))
    await settle()
    expect(passes).toHaveLength(1)

    transcriber.pauseEnded?.()
    transcriber.push(audio(1))
    await settle()
    expect(passes).toHaveLength(2)
  })

  it('a partial that ends after the pause does not roll into another', async () => {
    const { transcriber, passes } = fakeEngine()
    transcriber.begin()
    for (let i = 0; i < 2; i += 1) transcriber.push(audio(1))
    await settle()
    expect(passes).toHaveLength(1)
    for (let i = 0; i < 4; i += 1) transcriber.push(audio(1))

    transcriber.pauseReached?.(audio(6))
    passes[0]!.release('scroll')
    await settle()

    // The partial ran out; the next pass is the pause decode, not a partial over the grown audio.
    expect(passes.map((pass) => pass.samples)).toEqual([2 * FRAME, 6 * FRAME])
  })
})
