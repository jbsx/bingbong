import type { WakeScores, WakeWordDetector } from '../../core/ports/wake'
import { WAKE_HEADS } from '../../core/ports/wake'

/**
 * Scripted wake scores for the e2e suite (BINGBONG_WAKE_SCRIPT): one score
 * per 1280-sample chunk, each head's last value repeats. Audio content is
 * ignored — the monitoring/gating math is what's under test above the seam.
 * A plain JSON array scripts the wake head only; the object form scripts
 * each head independently: {"wake": [...], "abort": [...], "holdOn": [...]}.
 */

type Head = keyof WakeScores
const HEADS = WAKE_HEADS

function isScoreList(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((s) => typeof s === 'number')
}

export function createScriptedWake(scoresJson: string): WakeWordDetector {
  const parsed: unknown = JSON.parse(scoresJson)
  const scripts = {} as Record<Head, number[]>
  if (isScoreList(parsed)) {
    scripts.wake = [...parsed]
    scripts.abort = [0]
    scripts.holdOn = [0]
  } else if (typeof parsed === 'object' && parsed !== null) {
    const record = parsed as Record<string, unknown>
    if (!HEADS.some((head) => record[head] !== undefined)) {
      throw new Error('BINGBONG_WAKE_SCRIPT must be a JSON array of numbers or a per-head object of arrays')
    }
    for (const head of HEADS) {
      const value = record[head]
      if (value === undefined) scripts[head] = [0]
      else if (isScoreList(value)) scripts[head] = [...value]
      else throw new Error('BINGBONG_WAKE_SCRIPT must be a JSON array of numbers or a per-head object of arrays')
    }
  } else {
    throw new Error('BINGBONG_WAKE_SCRIPT must be a JSON array of numbers or a per-head object of arrays')
  }

  const queues: Record<Head, number[]> = { wake: [...scripts.wake], abort: [...scripts.abort], holdOn: [...scripts.holdOn] }
  const lasts: Record<Head, number> = {
    wake: scripts.wake[scripts.wake.length - 1],
    abort: scripts.abort[scripts.abort.length - 1],
    holdOn: scripts.holdOn[scripts.holdOn.length - 1],
  }

  return {
    score() {
      const scores = {} as WakeScores
      for (const head of HEADS) {
        const queue = queues[head]
        if (queue.length > 0) lasts[head] = queue.shift() ?? lasts[head]
        scores[head] = lasts[head]
      }
      return Promise.resolve(scores)
    },
    reset() {},
  }
}
