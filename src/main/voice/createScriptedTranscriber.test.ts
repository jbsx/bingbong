import { afterEach, describe, expect, it, vi } from 'vitest'
import { createScriptedTranscriber } from './createScriptedTranscriber'

// BINGBONG_STT_SCRIPT's double: plain-string entries feed transcripts one per
// utterance; { text, delayMs } entries additionally hold the promise so e2e
// can observe the transcribing window (#38), where the real engine spends
// seconds per utterance.

afterEach(() => {
  vi.useRealTimers()
})

describe('createScriptedTranscriber', () => {
  it('returns plain-string entries immediately, one per utterance, then empty', async () => {
    const transcriber = createScriptedTranscriber(JSON.stringify(['first', 'second']))

    expect(await transcriber.transcribe(new Float32Array(512))).toBe('first')
    expect(await transcriber.transcribe(new Float32Array(512))).toBe('second')
    expect(await transcriber.transcribe(new Float32Array(512))).toBe('')
  })

  it('holds a { text, delayMs } entry for its delay before resolving the transcript', async () => {
    vi.useFakeTimers()
    const transcriber = createScriptedTranscriber(
      JSON.stringify([{ text: 'open the fixture page', delayMs: 150 }]),
    )

    const pending = transcriber.transcribe(new Float32Array(512))
    let settled = false
    void pending.then(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(149)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toBe('open the fixture page')
    expect(settled).toBe(true)
  })

  it('rejects entries without a string text', () => {
    expect(() => createScriptedTranscriber(JSON.stringify([{ delayMs: 100 }]))).toThrow(
      'BINGBONG_STT_SCRIPT must be a JSON array of strings or { text, delayMs } objects',
    )
  })

  it('rejects a non-number delayMs', () => {
    expect(() => createScriptedTranscriber(JSON.stringify([{ text: 'open the fixture page', delayMs: 'fast' }]))).toThrow(
      'BINGBONG_STT_SCRIPT must be a JSON array of strings or { text, delayMs } objects',
    )
  })
})
