import type { WakeWordDetector } from '../../core/ports/wake'

/**
 * Scripted wake scores for the e2e suite (BINGBONG_WAKE_SCRIPT): one score
 * per 1280-sample chunk, the last value repeats. Audio content is ignored —
 * the monitoring/gating math is what's under test above the seam.
 */
export function createScriptedWake(scoresJson: string): WakeWordDetector {
  const parsed: unknown = JSON.parse(scoresJson)
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((s) => typeof s === 'number')) {
    throw new Error('BINGBONG_WAKE_SCRIPT must be a JSON array of numbers')
  }
  const queue = [...(parsed as number[])]
  let last = queue[queue.length - 1]

  return {
    async score() {
      if (queue.length > 0) last = queue.shift() ?? last
      return last
    },
    reset() {},
  }
}
