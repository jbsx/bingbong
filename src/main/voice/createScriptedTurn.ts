import type { TurnDetector } from '../../core/ports/stt'

/**
 * Scripted turn check for the e2e suite (BINGBONG_TURN_SCRIPT, #357):
 * finished-probabilities consumed one per check, the last repeating — the
 * scripted VAD's shape. Audio content is ignored.
 */
export function createScriptedTurn(probsJson: string): TurnDetector {
  const parsed: unknown = JSON.parse(probsJson)
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((p) => typeof p === 'number')) {
    throw new Error('BINGBONG_TURN_SCRIPT must be a JSON array of numbers')
  }
  const queue = [...(parsed as number[])]
  let last = queue[queue.length - 1]

  return {
    async score() {
      if (queue.length > 0) last = queue.shift() ?? last
      return last
    },
  }
}
