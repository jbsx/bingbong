/** Mono 16 kHz PCM in, transcript text out (Moonshine in main). */
export interface Transcriber {
  /**
   * Streaming transcription (#40): the voice session begins a capture when
   * speech starts and pushes utterance frames as they arrive, so a streaming
   * engine can transcribe during speech; finish() resolves the final
   * transcript at the endpoint. Batch engines adapt via finalOnlyTranscriber
   * — their begin/push/cancel are no-ops and the partial stream stays silent.
   */

  /** Speech detected: a new utterance capture starts. */
  begin(): void
  /**
   * One 512-sample 16 kHz frame of the in-flight utterance, in order, from
   * the speech-start trigger on. Pre-roll before the trigger and the frame
   * that fires the endpoint are not pushed — finish() carries the complete
   * utterance including both, so pushes are for streaming partials only.
   */
  push(frame: Float32Array): void
  /**
   * Partial transcripts during speech — internal only (no live captions).
   * Returns the unsubscribe. Final-only engines never call the listener.
   */
  onPartial(listener: (text: string) => void): () => void
  /**
   * The endpoint fired: resolves the final transcript over the complete
   * utterance ('' when nothing was recognized) instead of throwing on empty
   * audio; adapter failures (missing model, native error) reject.
   */
  finish(pcm: Float32Array): Promise<string>
  /** Drops an in-flight capture without transcribing (disarm, blip discard). */
  cancel(): void
}

/** Per-frame speech probability source (Silero VAD in main). */
export interface VadScorer {
  /** Scores one 512-sample 16 kHz frame; resolves the speech probability. */
  score(frame: Float32Array): Promise<number>
  /** Clears model state between listening sessions. */
  reset(): void
}
