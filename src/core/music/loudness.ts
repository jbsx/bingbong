// YouTube's loudness normalisation (#460): a watch page plays its video at
// the player's remembered level × the track's loudness factor,
// 10^(−loudnessDb/20) from the player response's `audioConfig`. It only
// turns a loud track down: a quiet one plays at the level itself (measured
// 2026-10-26, muted headless Chrome: loudnessDb −11.56 read 1.0 at 100).

/** The share of the player's level a track plays at: 1 with no loudness in the response, never above 1. */
export function loudnessFactor(loudnessDb: number | null): number {
  if (loudnessDb === null || !Number.isFinite(loudnessDb)) return 1
  return Math.min(1, 10 ** (-loudnessDb / 20))
}

/**
 * The level (0–100) a new track's element takes so it sounds as loud as
 * the last (#460, the owner's matched level): the old element's level on
 * YouTube's own scale — ÷ the old track's factor — × the new track's.
 */
export function matchedLevel(level: number, fromDb: number | null, toDb: number | null): number {
  return Math.max(0, Math.min(100, (level / loudnessFactor(fromDb)) * loudnessFactor(toDb)))
}

/**
 * The loudness (dB) a track on the audio road is taken to have (#502): the
 * bare stream carries no `loudnessDb`, and is not normalised, so the road
 * plays it as YouTube would a typical track. Measured: the median level 51
 * songs opened at on the watch page from YouTube's default of 100 in the
 * overlap gate's kept OFF runs (2026-10-28, job 2820345c) was 53.5 —
 * factor 0.5346, so 20·log10(1/0.5346) ≈ 5.44 dB.
 */
export const ROAD_LOUDNESS_DB = 5.44

/** The level YouTube's player remembers on a fresh profile (0–100): a song on the road with none heard before it is carried from it (#502). */
export const YOUTUBE_DEFAULT_LEVEL = 100
