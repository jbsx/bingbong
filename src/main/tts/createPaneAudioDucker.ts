import type { WebContents } from 'electron'
import type { AudioDucker } from '../../core/ports/tts'
import { applyMediaVolumesScript, COLLECT_MEDIA_VOLUMES_SCRIPT, DUCK_FACTOR, duckedVolumes } from '../../core/tts/duckVolumes'

type DuckState = 'idle' | 'ducking' | 'ducked'

/**
 * Ducks the browser pane's media elements: collect current volumes, scale
 * them down, restore the exact prior levels afterwards. The state machine
 * matters because executeJavaScript is async — a restore that lands while the
 * duck is still in flight cancels it, so a short or failed line can never
 * leave the page ducked. Other failures (page mid-navigation, no media) are
 * swallowed — ducking is best-effort polish, never a reason to fail speech.
 */
export function createPaneAudioDucker(wc: WebContents, factor: number = DUCK_FACTOR): AudioDucker {
  let state: DuckState = 'idle'
  let originals: number[] = []

  function apply(volumes: number[]): void {
    if (wc.isDestroyed()) return
    void wc.executeJavaScript(applyMediaVolumesScript(volumes)).catch(() => {})
  }

  return {
    duck() {
      if (state !== 'idle' || wc.isDestroyed()) return
      state = 'ducking'
      void wc
        .executeJavaScript(COLLECT_MEDIA_VOLUMES_SCRIPT)
        .then((volumes) => {
          const current = Array.isArray(volumes) ? volumes.map(Number) : []
          if (state !== 'ducking') return
          originals = current
          state = 'ducked'
          apply(duckedVolumes(current, factor))
        })
        .catch(() => {
          if (state === 'ducking') state = 'idle'
        })
    },
    restore() {
      if (state === 'ducking') {
        // Duck never landed — cancel it instead of ducking a finished line.
        state = 'idle'
        return
      }
      if (state !== 'ducked') return
      state = 'idle'
      apply(originals)
    },
  }
}
