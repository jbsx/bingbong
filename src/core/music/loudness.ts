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
