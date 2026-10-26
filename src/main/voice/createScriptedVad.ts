import type { VadScorer } from '../../core/ports/stt'
import { timeModelLoad } from '../perf/modelLoads'

/**
 * Scripted VAD for the e2e suite (BINGBONG_VAD_SCRIPT): probabilities are
 * consumed one per 512-sample frame, the last value repeats. Audio content
 * is ignored — the endpointing math is what's under test above the seam.
 * With `loadMs` (BINGBONG_VAD_LOAD_MS, #442) it "loads" for that long from
 * its creation, timed as the `vad` load the real one is: the ear's cold
 * start held for a shot. A frame that arrives before the load is in scores
 * quiet once it is, so the script starts at the first frame after it.
 * With `fails` (BINGBONG_VAD_LOAD_FAIL, #447) the load rejects when it is
 * done and every score throws, as a Silero whose model would not load.
 */
export function createScriptedVad(probsJson: string, loadMs?: number, fails = false): VadScorer {
  const parsed: unknown = JSON.parse(probsJson)
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((p) => typeof p === 'number')) {
    throw new Error('BINGBONG_VAD_SCRIPT must be a JSON array of numbers')
  }
  const queue = [...(parsed as number[])]
  let last = queue[queue.length - 1]
  const loaded =
    loadMs === undefined ? null : timeModelLoad('vad', new Promise<void>((resolve, reject) => setTimeout(() => (fails ? reject(new Error('scripted VAD load failed')) : resolve()), loadMs)))
  let warm = loaded === null
  loaded?.then(
    () => {
      warm = true
    },
    () => {},
  )

  return {
    async score() {
      if (!warm) {
        await loaded
        return 0
      }
      if (queue.length > 0) last = queue.shift() ?? last
      return last
    },
    reset() {},
  }
}
