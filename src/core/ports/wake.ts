/** Per-head confidences from one scored chunk: the wake word plus the two interrupt heads. */
export interface WakeScores {
  /** "bing bong" — hands-free activation. */
  wake: number
  /** "abort" — cancels the active run (a no-op while idle). */
  abort: number
  /** "hold on" — pauses the active run for steering. */
  holdOn: number
}

/** Every head, in stable order — the single place the closed set is enumerated. */
export const WAKE_HEADS = ['wake', 'abort', 'holdOn'] as const satisfies readonly (keyof WakeScores)[]

/** Mono 16 kHz PCM in, per-head wake confidences out (openWakeWord trio or the Python sidecar in main). */
export interface WakeWordDetector {
  /**
   * Scores one 1280-sample (80 ms) chunk; resolves every head's confidence
   * (0..1). Adapter failures (missing model, dead sidecar) reject.
   */
  score(chunk: Float32Array): Promise<WakeScores>
  /**
   * Hears one chunk without scoring it (the VAD gate is shut, so no head
   * could fire, #435). The detector keeps what it needs so the next
   * score() returns exactly what it would have had every chunk been
   * scored. Absent, the caller scores every chunk.
   */
  skip?(chunk: Float32Array): void
  /** Clears feature buffers between listening episodes. */
  reset(): void
}

/** openWakeWord consumes 80 ms (1280-sample) chunks at 16 kHz. */
export const WAKE_CHUNK_SAMPLES = 1280

/** Both adapters reject audio that isn't a whole number of 80 ms chunks. */
export function assertWakeChunk(chunk: Float32Array): void {
  if (chunk.length === 0 || chunk.length % WAKE_CHUNK_SAMPLES !== 0) {
    throw new Error(`wake chunks must be a multiple of ${String(WAKE_CHUNK_SAMPLES)} samples, got ${String(chunk.length)}`)
  }
}
