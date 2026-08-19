import type { Transcriber } from '../ports/stt'

/**
 * Adapts a batch transcribe(pcm) → string to the streaming Transcriber port
 * (#40): begin/push/cancel are no-ops, the partial stream stays silent, and
 * finish() runs the batch pass over the complete utterance. The scripted
 * e2e double sits behind the streaming seam this way; the shipped engine
 * (Moonshine, #41) streams natively.
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
