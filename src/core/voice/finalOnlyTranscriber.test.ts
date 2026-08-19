import { describe, expect, it } from 'vitest'
import { finalOnlyTranscriber } from './finalOnlyTranscriber'

// The #40 streaming-port adapter for final-only engines (the scripted e2e
// double): the utterance arrives whole at the endpoint, lifecycle calls are
// no-ops, and the partial stream stays silent — externally the engine
// behaves exactly as before.

describe('finalOnlyTranscriber', () => {
  it('resolves finish with the batch transcript over the complete utterance', async () => {
    const seen: Float32Array[] = []
    const transcriber = finalOnlyTranscriber(async (pcm) => {
      seen.push(pcm)
      return 'open youtube'
    })

    const utterance = new Float32Array(22 * 512)
    await expect(transcriber.finish(utterance)).resolves.toBe('open youtube')
    expect(seen).toEqual([utterance])
  })

  it('rejects finish when the batch pass rejects — adapter failures propagate', async () => {
    const transcriber = finalOnlyTranscriber(async () => {
      throw new Error('stt model missing')
    })
    await expect(transcriber.finish(new Float32Array(512))).rejects.toThrow('stt model missing')
  })

  it('treats begin, push and cancel as no-ops and never emits partials', async () => {
    const transcriber = finalOnlyTranscriber(async () => 'done')
    const partials: string[] = []
    const off = transcriber.onPartial((text) => partials.push(text))

    transcriber.begin()
    transcriber.push(new Float32Array(512))
    transcriber.push(new Float32Array(512))
    await transcriber.finish(new Float32Array(1024))
    transcriber.cancel()
    off()

    expect(partials).toEqual([])
  })
})
