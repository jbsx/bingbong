import { describe, expect, it } from 'vitest'
import { createSmartWhisperTranscriber } from './createSmartWhisperTranscriber'

// Fake smart-whisper: records constructor args and transcribe params, returns
// one segment per call.
function fakeLib() {
  const calls: { modelPath: string; params: Record<string, unknown> }[] = []
  const lib = {
    Whisper: class {
      constructor(public modelPath: string) {}
      async transcribe(_pcm: Float32Array, params: Record<string, unknown> = {}) {
        calls.push({ modelPath: this.modelPath, params })
        return { result: Promise.resolve([{ text: ' open youtube' }]) }
      }
      async free() {}
    },
  }
  return { lib, calls }
}

describe('createSmartWhisperTranscriber', () => {
  it('passes the initial prompt through to whisper for vocabulary biasing', async () => {
    const { lib, calls } = fakeLib()
    const transcriber = createSmartWhisperTranscriber({
      modelPath: '/models/ggml-base.en.bin',
      initialPrompt: 'Linus Tech Tips, MKBHD, YouTube',
      loadLib: async () => lib as unknown as never,
    })
    await transcriber.transcribe(new Float32Array(512))
    expect(calls[0].params.initial_prompt).toBe('Linus Tech Tips, MKBHD, YouTube')
    expect(calls[0].params.language).toBe('en')
  })

  it('omits initial_prompt when no prompt is configured', async () => {
    const { lib, calls } = fakeLib()
    const transcriber = createSmartWhisperTranscriber({
      modelPath: '/models/ggml-base.en.bin',
      loadLib: async () => lib as unknown as never,
    })
    await transcriber.transcribe(new Float32Array(512))
    expect(calls[0].params.initial_prompt).toBeUndefined()
  })
})
