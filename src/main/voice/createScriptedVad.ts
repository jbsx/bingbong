import type { VadScorer } from '../../core/ports/stt'

/**
 * Scripted VAD for the e2e suite (BINGBONG_VAD_SCRIPT): probabilities are
 * consumed one per 512-sample frame, the last value repeats. Audio content
 * is ignored — the endpointing math is what's under test above the seam.
 */
export function createScriptedVad(probsJson: string): VadScorer {
  const parsed: unknown = JSON.parse(probsJson)
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((p) => typeof p === 'number')) {
    throw new Error('BINGBONG_VAD_SCRIPT must be a JSON array of numbers')
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
