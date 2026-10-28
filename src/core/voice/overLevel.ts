// The person's voice in a capture over the app's ducked voice (#490): by level.
//
// Under the duck the app's own voice reaches the mic at its floor (15 %,
// about −16 dB), and it keeps the capture open as long as it talks: a
// person's line said into it is folded into an echo capture up to 30 s
// long, and Parakeet decoding the whole of it merges the line into the
// echo ("282 Move On Go Live" came out "Two Hundred and Eighty Two Man Go
// Live"). The level tells them apart where the words cannot: a stretch
// well above the ducked echo is the person's. Once that stretch has ended,
// the capture is cut there and the stretch alone is read.

/**
 * Frames after the duck is asked before its level counts: the app's voice
 * is still at full level while the duck lands, up to 0.61 s into the gate's
 * captures. Measured on the 223 speaking-time dumps the gate kept (the three
 * with a person's "Move on." in them, the rest the app's own): at 20 frames,
 * ratio 3 and the 75th percentile, all 3 found and 1 echo stretch taken
 * (read own after); 10 and 16 frames took 2–3 starts before the duck, a
 * ratio of 3.5 or more or the 90th percentile lost a person. Every number
 * here is a guess on that one corpus; the kiosk's dumps settle them.
 */
export const OVER_LEVEL_SETTLE_FRAMES = 20

/** Settled frames needed before the echo's level is known. A guess. */
export const OVER_LEVEL_FLOOR_FRAMES = 16

/** The echo's level: this share of settled frames is at or under it (its voiced frames, not its gaps). A guess. */
export const OVER_LEVEL_PERCENTILE = 0.75

/** A frame this many times the echo's level is the person's (≈ +10 dB). A guess, set on the first measure. */
export const OVER_LEVEL_RATIO = 3

/** Loud frames a stretch needs: about 190 ms, a short word. A guess. */
export const OVER_LEVEL_MIN_FRAMES = 6

/** Quiet frames inside a stretch that do not end it (a gap between words). A guess. */
export const OVER_LEVEL_GAP_FRAMES = 6

/** Quiet frames after a stretch that end it: about 380 ms. A guess. */
export const OVER_LEVEL_END_FRAMES = 12

/**
 * Frames kept ahead of a stretch when it is cut out: none. A person's onset
 * is sharp over the ducked echo, and any lead hands Parakeet the echo's last
 * syllable: the gate's three live "Move on." cuts read "Move on." at a lead
 * of 0–1 frames, and "But move on.", "Wait, move on.", "Point.", "Two
 * points." and "Take a tune." at 2–10; a live run at 1 read "To move on."
 * (Fate 0.59, under the runner's 0.7), so the lead went to 0 (#490).
 */
export const OVER_LEVEL_LEAD_FRAMES = 0

/**
 * Frames kept after a stretch's last loud frame: about 260 ms, the line's
 * softer last syllable ("on" under "Move"). The same three cuts read "Move
 * on." at 0–8 frames; at 12 the echo after it rode in ("Move all").
 */
export const OVER_LEVEL_TAIL_FRAMES = 8

export interface LoudStretch {
  /** The first frame of the cut, counted from the capture's first frame. */
  readonly from: number
  /** One past its last frame: a little of the quiet after the loud frames rides with it. */
  readonly to: number
}

/** The read's numbers: the constants above unless a measure sets them. */
export interface OverLevelTuning {
  readonly settle: number
  readonly floorFrames: number
  readonly percentile: number
  readonly ratio: number
  readonly minFrames: number
  readonly gapFrames: number
  readonly endFrames: number
  readonly leadFrames: number
  readonly tailFrames: number
}

export const OVER_LEVEL_TUNING: OverLevelTuning = {
  settle: OVER_LEVEL_SETTLE_FRAMES,
  floorFrames: OVER_LEVEL_FLOOR_FRAMES,
  percentile: OVER_LEVEL_PERCENTILE,
  ratio: OVER_LEVEL_RATIO,
  minFrames: OVER_LEVEL_MIN_FRAMES,
  gapFrames: OVER_LEVEL_GAP_FRAMES,
  endFrames: OVER_LEVEL_END_FRAMES,
  leadFrames: OVER_LEVEL_LEAD_FRAMES,
  tailFrames: OVER_LEVEL_TAIL_FRAMES,
}

export interface OverLevel {
  /** One frame of the capture, in order; a stretch the person said that has just ended, or null. */
  push(frame: Float32Array): LoudStretch | null
}

/** Root mean square of one frame. */
export function frameLevel(frame: Float32Array): number {
  let sum = 0
  for (const sample of frame) sum += sample * sample
  return frame.length === 0 ? 0 : Math.sqrt(sum / frame.length)
}

/**
 * Reads a capture over the ducked voice frame by frame. The echo's level is
 * read from every settled frame so far, so a person who spoke first is
 * found loud once the echo has been heard after them.
 */
export function createOverLevel(tuning: OverLevelTuning = OVER_LEVEL_TUNING): OverLevel {
  const { settle, floorFrames, percentile, ratio, minFrames, gapFrames, endFrames, leadFrames, tailFrames } = tuning
  const levels: number[] = []
  let reported = false
  return {
    push(frame) {
      levels.push(frameLevel(frame))
      if (reported) return null
      const settled = levels.slice(settle)
      if (settled.length < floorFrames) return null
      const sorted = [...settled].sort((a, b) => a - b)
      const echo = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percentile))]!
      if (echo <= 0) return null
      // Only settled frames count: before the duck lands, the app's own voice is as loud as a person.
      const loud = (index: number): boolean => index >= settle && levels[index]! >= echo * ratio
      // The last loud frame must be far enough back that the stretch has ended.
      const last = levels.length - 1
      let end = last
      while (end >= settle && !loud(end)) end--
      if (end < settle || last - end < endFrames) return null
      // Walk back over the stretch, across short gaps.
      let start = end
      let count = 0
      let gap = 0
      for (let index = end; index >= settle; index--) {
        if (loud(index)) {
          count++
          start = index
          gap = 0
        } else if (++gap > gapFrames) break
      }
      if (count < minFrames) return null
      // A stretch reaching back to the settle is a person who spoke first: its onset is found among the loud frames before it.
      if (start === settle) while (start > 0 && levels[start - 1]! >= echo * ratio) start--
      reported = true
      // It keeps a little quiet after its last loud frame, where a softer last syllable may be, and no more: a stretch found late (a
      // person who spoke first, before the echo's level was known) is followed by echo.
      return { from: Math.max(0, start - leadFrames), to: Math.min(levels.length, end + 1 + tailFrames) }
    },
  }
}
