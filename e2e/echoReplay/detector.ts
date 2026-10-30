// The person starting over the app's voice, heard on a mic stream no canceller has touched (#515). The echo reaches the
// kiosk's mic with little above 2 kHz (#490) and a person has some, so the level of that band is the tell: a rise over
// what the band has been while the app talks. The share of it in the frame, #490's own marker, separates the labelled
// clips but not a raw stream frame by frame: AUC 0.85–0.97 for the level against less for the share on the takes here.
//
// It stays here, in the measure: the duck it drives missed #515's bar (the first ~0.25 s of a line, which is most of
// what the canceller takes at a 100 % sink, is gone before any duck a person's voice starts can land), so no app code
// uses it. `--detect` and a `spans:` arm re-run that result on any new take.

import { FRAME, FRAME_S, mergeSpans, RATE, type Span } from './score.ts'

export interface DetectorTuning {
  /** Frames the level is averaged over, in dB. */
  readonly smooth: number
  /** Decibels over the floor that make a person. */
  readonly over: number
  /** The floor: this percentile of the level over the last `floorFrames`, ending `floorGapFrames` back, so a line does not raise its own. */
  readonly percentile: number
  readonly floorFrames: number
  readonly floorGapFrames: number
  /** Frames heard before the floor is trusted at all. */
  readonly warmFrames: number
}

/** The grid's pick on the three takes (#515). In its loop, in the read: lines caught 9/9, 9/9, 7/9 at sink 100, 116, 146 %, 3/3 of the real talk-over; false ducks per 105 s 1, 7, 15. */
export const DETECTOR_TUNING: DetectorTuning = { smooth: 4, over: 12, percentile: 0.8, floorFrames: 250, floorGapFrames: 16, warmFrames: 62 }

const CUT_HZ = 2000
const HANN = Float64Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)))
const POWER_SCALE = FRAME * FRAME * 0.375

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j]!, re[i]!]
      ;[im[i], im[j]] = [im[j]!, im[i]!]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(angle * k)
        const wi = Math.sin(angle * k)
        const a = i + k
        const b = a + len / 2
        const tr = re[b]! * wr - im[b]! * wi
        const ti = re[b]! * wi + im[b]! * wr
        re[b] = re[a]! - tr
        im[b] = im[a]! - ti
        re[a] = re[a]! + tr
        im[a] = im[a]! + ti
      }
    }
  }
}

/** The level of one 512-sample frame's band above 2 kHz, in dB. */
export function highBandDb(frame: Float32Array): number {
  const re = new Float64Array(FRAME)
  const im = new Float64Array(FRAME)
  for (let i = 0; i < FRAME; i++) re[i] = (frame[i] ?? 0) * HANN[i]!
  fft(re, im)
  let power = 0
  for (let bin = Math.ceil((CUT_HZ * FRAME) / RATE); bin <= FRAME / 2; bin++) power += re[bin]! ** 2 + im[bin]! ** 2
  return 10 * Math.log10(power / POWER_SCALE + 1e-14)
}

export interface HighBandDetector {
  /** One frame's level; true when it reads as a person now. */
  push(levelDb: number): boolean
  /** While ducked the echo is not the echo the floor knows: the floor stops learning. */
  freeze(on: boolean): void
}

export function createHighBandDetector(tuning: DetectorTuning = DETECTOR_TUNING): HighBandDetector {
  const recent: number[] = []
  const heard: number[] = []
  let frozen = false
  return {
    freeze(on) {
      frozen = on
    },
    push(levelDb) {
      recent.push(levelDb)
      if (recent.length > tuning.smooth) recent.shift()
      const smoothed = recent.reduce((sum, level) => sum + level, 0) / recent.length
      if (!frozen) {
        heard.push(smoothed)
        if (heard.length > tuning.floorFrames + tuning.floorGapFrames) heard.shift()
      }
      if (heard.length < tuning.warmFrames) return false
      const floor = heard.slice(0, Math.max(1, heard.length - tuning.floorGapFrames)).sort((a, b) => a - b)
      return smoothed - floor[Math.min(floor.length - 1, Math.floor(floor.length * tuning.percentile))]! >= tuning.over
    },
  }
}

export interface DuckPlan {
  readonly landing: number
  readonly hold: number
  readonly share: number
}

/**
 * The detector in its loop, on an echo and a person kept apart: what it hears at each frame is the echo as ducked by its
 * own earlier fires, plus the person, whom the duck never touches. The landing is how long a fire takes to reach the
 * speaker; a fire inside a duck extends it.
 */
export function simulateDuck(echo: Float32Array, person: Float32Array, plan: DuckPlan, tuning: DetectorTuning = DETECTOR_TUNING): { readonly spans: Span[]; readonly fires: number[] } {
  const detector = createHighBandDetector(tuning)
  const spans: Span[] = []
  const fires: number[] = []
  const frame = new Float32Array(FRAME)
  let duckedTo = -1
  let duckFrom = -1
  for (let index = 0; (index + 1) * FRAME <= echo.length; index++) {
    const now = index * FRAME_S
    const ducked = now >= duckFrom && now < duckedTo
    for (let i = 0; i < FRAME; i++) frame[i] = echo[index * FRAME + i]! * (ducked ? plan.share : 1) + (person[index * FRAME + i] ?? 0)
    // Frozen from the fire, not the landing: the frames between hold a person, not the echo.
    detector.freeze(now < duckedTo)
    if (detector.push(highBandDb(frame))) {
      const heardAt = now + FRAME_S
      if (heardAt >= duckedTo) {
        fires.push(heardAt)
        duckFrom = heardAt + plan.landing
        spans.push({ from: duckFrom, to: duckFrom })
      }
      duckedTo = heardAt + plan.hold
      const last = spans.at(-1)!
      spans[spans.length - 1] = { from: last.from, to: Math.max(last.from, duckedTo) }
    }
  }
  return { spans: mergeSpans(spans), fires }
}
