export type SpeakOutcome = { ok: true } | { ok: false; error: string }

export interface SpeakOptions {
  /**
   * Keys the text's synthesis, playback and first-sound perf spans to its
   * turn (#31, #327); callers without a turn (download announcements) omit it.
   */
  readonly turnId?: string
  /** Called once, when the text's first sample is handed to the player (#327): the Reaction of a Command whose output is speech closes on it. */
  readonly onFirstSound?: () => void
}

export interface TtsSpeaker {
  /**
   * Voice one text, sentence by sentence (#327); resolves when playback
   * finishes (or is stopped). TTS failures resolve with `ok: false` instead
   * of throwing, so callers degrade to display-only without a try/catch.
   */
  speak(text: string, options?: SpeakOptions): Promise<SpeakOutcome>
  /** Barge-in hook (wake word, T10): kills playback and queued lines instantly. Safe to call anytime. */
  stop(): void
}

/** Text → WAV bytes (piper in main). */
export interface SpeechSynthesizer {
  synthesize(text: string): Promise<Uint8Array>
  /** How many synthesizer processes have been started so far (#327): a persistent piper stays at one per voice; the perf log carries it. */
  spawnCount?(): number
}

export interface AudioPlayback {
  /** Resolves on natural end or after stop(); rejects on playback failure. */
  done: Promise<void>
  stop(): void
}

export interface AudioPlayer {
  play(wav: Uint8Array): AudioPlayback
}

/**
 * One continuous playback a spoken text's sentences are written into, in
 * order (#327): no start gap between them, and stop() cuts within a frame.
 */
export interface AudioStream extends AudioPlayback {
  /** Hand one sentence's WAV to the stream; it plays after the ones before it. */
  write(wav: Uint8Array): void
  /** No more sentences: `done` resolves once the last has played. */
  end(): void
}

export interface AudioStreamPlayer {
  /** Open a stream; `onFirstSample` is called once, when its first sample is handed to the device. */
  open(options?: { onFirstSample?: () => void }): AudioStream
}

/** Lowers page audio while the assistant talks and restores the prior level after. */
export interface AudioDucker {
  duck(): void
  restore(): void
}

/** Answers "is anything being said right now" — the mic takes no Utterance while a line plays (#326). */
export interface TtsIdle {
  /** Whether a text is being synthesized or played now: true from its first sentence to its last (#327), so the mic takes no Utterance while piper plays (#326). */
  isSpeaking(): boolean
  /** Resolves when nothing is being said. */
  waitIdle(): Promise<void>
}
