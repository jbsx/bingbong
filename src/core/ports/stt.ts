/** Mono 16 kHz PCM in, transcript text out (Parakeet in main, Moonshine the lighter tier). */
export interface Transcriber {
  /** The engine behind the port ('parakeet', 'moonshine', …), named on the `stt` perf span (#358). */
  readonly engine?: string
  /** Audio the last final sent off this machine, in ms (#463): the cloud ear's usage. Absent for a local engine. */
  readonly sentMs?: number
  /** The keyterms the last socket was opened with (#471): the exact ask of the cloud ear, named on the `stt` span so a dump replays it. Absent for a local engine. */
  readonly keyterms?: readonly string[]
  /**
   * Streaming transcription (#40): the voice session begins a capture when
   * speech starts and pushes utterance frames as they arrive, so a streaming
   * engine can transcribe during speech; finish() resolves the final
   * transcript at the endpoint. Batch engines adapt via finalOnlyTranscriber
   * — their begin/push/cancel are no-ops and the partial stream stays silent.
   */

  /**
   * Speech detected: a new utterance capture starts. `preRoll` is the audio
   * kept before the trigger frame (#463): an engine that hears only what it
   * is sent (the cloud ear) sends it first, so the first syllable survives;
   * an engine that decodes finish()'s PCM ignores it.
   */
  begin(preRoll?: Float32Array): void
  /**
   * The listen opened (wake word or hotkey, #463): an engine with a
   * connection to make makes it now, while the owner starts to speak.
   * Absent for engines with nothing to open.
   */
  listenOpened?(): void
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
  /**
   * The pause is reached (#443): decode this audio now, beside the turn
   * check, as the likely final; a finish() over audio of the same length in
   * this capture resolves its words without a second pass. No partial starts
   * from here until pauseEnded(). Absent for engines with no partials.
   */
  pauseReached?(pcm: Float32Array): void
  /** Speech came back after the pause (#443): its decode is not the final, and partials roll again. */
  pauseEnded?(): void
  /**
   * Loads the engine's sessions ahead of the first finish() (#430), so the
   * first line after a boot pays no load; a failure rejects and the next
   * pass retries. Absent for engines with nothing to load.
   */
  prepare?(): Promise<void>
}

/**
 * End-of-turn source (Smart Turn in main, #357): asked at a short pause
 * whether the Utterance so far reads finished. Resolves the probability
 * that it is; a missing model or native error rejects.
 */
export interface TurnDetector {
  /** Mono 16 kHz PCM of the Utterance so far, pause included. */
  score(pcm: Float32Array): Promise<number>
}

/** Per-frame speech probability source (Silero VAD in main). */
export interface VadScorer {
  /** Scores one 512-sample 16 kHz frame; resolves the speech probability. */
  score(frame: Float32Array): Promise<number>
  /** Clears model state between listening sessions. */
  reset(): void
}
