// The score of one kiosk replay (#512 arm d′, #515): the person's frames over the read through the processed mic, read
// by Silero, line by line, and the false frames and level of the echo left alone between them. Everything here is pure,
// so the measure's arithmetic is tested and only the room needs Electron.

/** The capture's rate and Silero's frame (micCapture.ts, vadEndpointing.ts). */
export const RATE = 16_000
export const FRAME = 512
export const FRAME_S = FRAME / RATE

/** The owner's lines in their 7.5 s piece, in seconds (14:28 mic-raw 64.5–72.0 s, the three they said in its quiet). */
export const LINES: readonly (readonly [number, number])[] = [[0.25, 0.75], [1.5, 2.25], [6.5, 7.25]]
/** Where the piece goes into a take: before any audio (alone), then three times inside the read over music. */
export const ALONE_AT = 3
export const OVER_AT: readonly number[] = [40, 75, 110]
/** Stretches of the read with nobody over it, where a Silero frame ≥ 0.5 is a false one. */
export const ECHO_STRETCHES: readonly (readonly [number, number])[] = [[20, 38], [50, 73], [85, 108]]
/** Seconds of each take replayed. */
export const TAKE_S = 125
/** A weak line holds a shorter longest run than this: all 9 lines held it at 100 % in the d′ replay. Stricter than the endpointer's 3 frames, as a line must also carry its words. */
export const HEARD_RUN = 11

/**
 * Where a second of the take lands on the capture, past the read's start. The air is held 100 ms behind the reference
 * and arrives 0.21 s after it (cross-correlated on the raw stream, three runs: 0.209–0.222); the windows stay 0.05 s
 * ahead of that, where the d′ report's sat, so its numbers still compare. The capture's first block is a further 1024 samples in.
 */
const AIR_PAD_S = 0.16
const FIRST_BLOCK = 1024

const SPEECH = 0.5

export interface LineScore {
  readonly frames: number
  readonly of: number
  readonly run: number
  /** Seconds from the window's start to its first speech frame; null when none. */
  readonly onset: number | null
}

export interface RunScore {
  readonly alone: readonly LineScore[]
  readonly over: readonly LineScore[]
  readonly overFrames: number
  readonly overOf: number
  readonly falseFrames: number
  readonly falseOf: number
  /** Mean level of the echo left over the stretches, dBFS. */
  readonly echoDb: number
}

/** Which frame of a capture holds second `t` of the take, given when the read started on the capture's clock. */
export function frameAt(t: number, readStartS: number): number {
  return Math.floor((Math.round((readStartS + AIR_PAD_S + t) * RATE) + FIRST_BLOCK) / FRAME)
}

export function scoreLine(scores: readonly number[]): LineScore {
  let frames = 0
  let current = 0
  let run = 0
  let onset: number | null = null
  scores.forEach((score, index) => {
    if (score >= SPEECH) {
      frames++
      current++
      run = Math.max(run, current)
      onset ??= index * FRAME_S
    } else current = 0
  })
  return { frames, of: scores.length, run, onset }
}

export function scoreRun(scores: readonly number[], pcm: Float32Array, readStartS: number): RunScore {
  const window = (a: number, b: number): readonly number[] => scores.slice(frameAt(a, readStartS), frameAt(b, readStartS))
  const lines = (at: number): LineScore[] => LINES.map(([a, b]) => scoreLine(window(at + a, at + b)))
  const over = OVER_AT.flatMap(lines)
  let falseFrames = 0
  let falseOf = 0
  let energy = 0
  let samples = 0
  for (const [a, b] of ECHO_STRETCHES) {
    const stretch = window(a, b)
    falseOf += stretch.length
    falseFrames += stretch.filter((score) => score >= SPEECH).length
    const from = frameAt(a, readStartS) * FRAME
    const to = frameAt(b, readStartS) * FRAME
    for (let i = from; i < to && i < pcm.length; i++) {
      energy += pcm[i]! ** 2
      samples++
    }
  }
  return {
    alone: lines(ALONE_AT),
    over,
    overFrames: over.reduce((sum, line) => sum + line.frames, 0),
    overOf: over.reduce((sum, line) => sum + line.of, 0),
    falseFrames,
    falseOf,
    echoDb: 10 * Math.log10(energy / Math.max(1, samples) + 1e-12),
  }
}

export interface Span {
  readonly from: number
  readonly to: number
}

/** A fire holds the duck this long past its line (the guess the offline duck is run on: a line's gap stays ducked). */
export const DUCK_HOLD_S = 1

/** Spans that touch become one: the voice does not come back between them. */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const merged: Span[] = []
  for (const span of [...spans].sort((a, b) => a.from - b.from)) {
    const last = merged.at(-1)
    if (last && span.from <= last.to) merged[merged.length - 1] = { from: last.from, to: Math.max(last.to, span.to) }
    else merged.push({ ...span })
  }
  return merged
}

/** Interleaved samples with the spans held at `share`: the echo and the reference fall together, as a gain ahead of playback does. */
export function applyDuck(samples: Float32Array, channels: number, rate: number, spans: readonly Span[], share: number): Float32Array {
  const out = samples.slice()
  for (const { from, to } of spans) {
    const a = Math.max(0, Math.round(from * rate)) * channels
    const b = Math.min(out.length, Math.round(to * rate) * channels)
    for (let i = a; i < b; i++) out[i] = out[i]! * share
  }
  return out
}

/** The spans an oracle duck holds: from each line's own start, `landing` seconds later, to its end plus the hold. */
export function oracleSpans(onsets: readonly number[], landing: number): Span[] {
  return mergeSpans(OVER_AT.flatMap((at) => LINES.map(([, b], index) => ({ from: at + onsets[index]! + landing, to: at + b + DUCK_HOLD_S }))))
}

/**
 * Where each line starts in the piece: the first frame inside its window, or just ahead of it, above the level. The
 * windows are the d′ report's quarter seconds, which is good enough to score on and too coarse to land a duck on.
 */
export function lineOnsets(piece: Float32Array, levelDb = -40): number[] {
  const threshold = 10 ** (levelDb / 20)
  return LINES.map(([a, b]) => {
    const from = Math.max(0, Math.floor(((a - 0.25) * RATE) / FRAME))
    const to = Math.floor((b * RATE) / FRAME)
    for (let frame = from; frame < to; frame++) {
      let energy = 0
      for (let i = frame * FRAME; i < (frame + 1) * FRAME; i++) energy += (piece[i] ?? 0) ** 2
      if (Math.sqrt(energy / FRAME) >= threshold) return frame * FRAME_S
    }
    return a
  })
}

export const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
export const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length === 0 ? Number.NaN : sorted[Math.floor(sorted.length / 2)]!
}
