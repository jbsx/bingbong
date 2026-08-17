/** Mono 16 kHz PCM in, transcript text out (whisper in main). */
export interface Transcriber {
  /**
   * Transcribes one utterance. Resolves with the recognized text ('' when
   * nothing was recognized) instead of throwing on empty audio; adapter
   * failures (missing model, native error) reject.
   */
  transcribe(pcm: Float32Array): Promise<string>
}

/** Per-frame speech probability source (Silero VAD in main). */
export interface VadScorer {
  /** Scores one 512-sample 16 kHz frame; resolves the speech probability. */
  score(frame: Float32Array): Promise<number>
  /** Clears model state between listening sessions. */
  reset(): void
}
