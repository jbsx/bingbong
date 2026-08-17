export type SpeakOutcome = { ok: true } | { ok: false; error: string }

export interface TtsSpeaker {
  /**
   * Voice one line; resolves when playback finishes (or is stopped). TTS
   * failures resolve with `ok: false` instead of throwing, so callers degrade
   * to display-only without a try/catch.
   */
  speak(text: string): Promise<SpeakOutcome>
  /** Barge-in hook (wake word, T10): kills playback and queued lines instantly. Safe to call anytime. */
  stop(): void
}

/** Text → WAV bytes (piper in main). */
export interface SpeechSynthesizer {
  synthesize(text: string): Promise<Uint8Array>
}

export interface AudioPlayback {
  /** Resolves on natural end or after stop(); rejects on playback failure. */
  done: Promise<void>
  stop(): void
}

export interface AudioPlayer {
  play(wav: Uint8Array): AudioPlayback
}

/** Lowers page audio while the assistant talks and restores the prior level after. */
export interface AudioDucker {
  duck(): void
  restore(): void
}
