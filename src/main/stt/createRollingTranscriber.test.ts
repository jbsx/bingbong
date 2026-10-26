import { describe, expect, it } from 'vitest'
import { createRollingTranscriber } from './createRollingTranscriber'

// The rolling partials every batch-pass engine shares (#41, #358): the
// first pass waits for half a second of speech by default (#441).

const FRAME = 512

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
