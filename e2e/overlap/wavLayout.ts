// The one wav Chromium's fake mic plays for a spoken Sequence Case (#486):
// the wake word, every line and every noise at its ms, mixed where they
// overlap, silence between, and a tail long enough that the file never
// loops back to its start inside a run.

export interface WavPiece {
  readonly pcm: Float32Array
  readonly atMs: number
}

export function layoutWav(pieces: readonly WavPiece[], totalMs: number, rate = 16_000): Float32Array {
  const out = new Float32Array(Math.round((totalMs / 1000) * rate))
  for (const piece of pieces) {
    const from = Math.round((piece.atMs / 1000) * rate)
    for (let i = 0; i < piece.pcm.length && from + i < out.length; i++) out[from + i] = Math.max(-1, Math.min(1, out[from + i]! + piece.pcm[i]!))
  }
  return out
}
