import type { Transcriber } from '../ports/stt'

/**
 * Adapts a batch transcribe(pcm) → string to the streaming Transcriber port
 * (#40): begin/push/cancel are no-ops, the partial stream stays silent, and
 * finish() runs the batch pass over the complete utterance. Whisper.cpp, the
 * scripted e2e double and the #39 Moonshine proof-of-life sit behind the
 * streaming seam this way until the Moonshine swap (#41).
 */
export function finalOnlyTranscriber(transcribe: (pcm: Float32Array) => Promise<string>): Transcriber {
  return {
    begin() {},
    push() {},
    onPartial() {
      return () => {}
    },
    finish: (pcm) => transcribe(pcm),
    cancel() {},
  }
}
